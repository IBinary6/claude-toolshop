'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolvePython } = require('../lib/python');
const { isExcludedPath } = require('../lib/target');

const isWindows = process.platform === 'win32';
const MAX_ERRORS_SHOWN = 5;
const CPPLINT_PY = path.join(__dirname, '..', 'cpplint', 'cpplint.py');

/**
 * Parse cpplint stderr lines of the form `path:line:  message  [category] [confidence]`.
 * @param {string} out Raw stderr text.
 * @returns {Array<{line:number, category:string, message:string}>}
 * @example
 * parseCpplintOutput('a.cc:3:  Missing space  [whitespace/comma] [3]')
 * // [{ line: 3, message: 'Missing space', category: 'whitespace/comma' }]
 */
function parseCpplintOutput(out) {
  const violations = [];
  const re = /^.*?:(\d+):\s+(.*?)\s+\[([^\]]+)\](?:\s+\[\d+\])?\s*$/;
  for (const raw of String(out).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    violations.push({ line: parseInt(m[1], 10), message: m[2].trim(), category: m[3].trim() });
  }
  return violations;
}

/**
 * Checks that are always disabled.
 * - whitespace/indent_namespace: Google style does not indent namespace contents, but
 *   clang-format only reformats changed lines, so old code may still be indented; suppressing
 *   the check avoids a cascade of NOLINT comments pushing lines past 80 columns.
 * - legal/copyright: this plugin does not manage copyright headers.
 */
const DEFAULT_FILTERS = ['-whitespace/indent_namespace', '-legal/copyright'];

/**
 * Merge the default filters, the optional include-order suppression and caller-provided extras
 * into the single comma-separated `--filter` value cpplint accepts (deduplicated).
 * Returns null when there is nothing to filter.
 * @param {{preserveIncludeOrder?:boolean, extraFilters?:string[]}} options
 * @returns {string|null}
 * @example
 * buildFilterArg({ preserveIncludeOrder: true })
 * // '--filter=-whitespace/indent_namespace,-legal/copyright,-build/include_order'
 */
function buildFilterArg(options = {}) {
  const filters = [...DEFAULT_FILTERS];
  if (options.preserveIncludeOrder) filters.push('-build/include_order');
  if (Array.isArray(options.extraFilters)) filters.push(...options.extraFilters);
  const uniq = [];
  const seen = new Set();
  for (const f of filters) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    uniq.push(f);
  }
  if (uniq.length === 0) return null;
  return '--filter=' + uniq.join(',');
}

/**
 * Run cpplint directly on the real file path (no temporary copy).
 *
 * Why no temporary copy: cpplint derives the expected header-guard macro from the file path and
 * matches the basename against the "primary header" for include_order. A hashed temporary name
 * makes both wrong; running on the real path keeps both correct.
 *
 * The bundled cpplint reads sources as utf-8-sig, so a BOM is ignored. This step never writes
 * the file, so even if the process is interrupted the BOM, mtime, LF/CRLF and original bytes
 * are untouched.
 *
 * Visual Studio callers pass preserveIncludeOrder so the check does not conflict with the
 * formatter policy of keeping dependency-sensitive include order. Other projects still check
 * include order according to their cpplint configuration.
 * @param {string} filePath
 * @param {{root?:string, preserveIncludeOrder?:boolean, extraFilters?:string[], timeoutMs?:number}} options
 * @returns {Array<{line:number, category:string, message:string}>}
 * @example
 * runCpplint('/proj/src/a.cc', { root: '/proj' }) // [] when the file is clean
 */
function runCpplint(filePath, options = {}) {
  // Hook entry points already filter; skip third-party and build-output directories even when
  // this wrapper is called directly.
  if (isExcludedPath(filePath)) return [];
  const failure = (message, category = 'runtime/cpplint') => [{ line: 0, category, message }];
  let python;
  try { python = (options.resolvePython || resolvePython)(); } catch (error) {
    return failure(`Cannot detect Python: ${error.message || error}`);
  }
  if (!python || !fs.existsSync(CPPLINT_PY)) {
    return failure('Python/cpplint is unavailable; this check was not run');
  }

  try { fs.accessSync(filePath, fs.constants.R_OK); } catch (_) {
    return failure('Cannot read the file to check; this check was not run');
  }

  const args = [CPPLINT_PY, '--quiet'];
  if (options.root) args.push('--root=' + options.root);
  const filterArg = buildFilterArg(options);
  if (filterArg) args.push(filterArg);
  args.push(filePath);

  try {
    const r = (options.spawnSync || spawnSync)(python.cmd, [...python.args, ...args], {
      stdio: 'pipe',
      timeout: Math.max(1000, options.timeoutMs || 15000),
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: isWindows,
    });
    if (r.error && r.error.code === 'ETIMEDOUT') {
      return failure('cpplint timed out; the check did not complete', 'runtime/timeout');
    }
    if (r.error) return failure(`cpplint could not run: ${r.error.code || r.error.message}`);
    const stderr = (r.stderr || Buffer.alloc(0)).toString('utf-8');
    const violations = parseCpplintOutput(stderr);
    if (r.status !== 0 && violations.length === 0) {
      return failure(`cpplint ended abnormally (exit code ${r.status}); the check did not complete`);
    }
    if (/Skipping input|Can't open for reading|Error reading config|Invalid configuration|Line length must be numeric/i.test(stderr)) {
      return [...violations, ...failure('cpplint could not read the source or its configuration; the check did not complete')];
    }
    return violations;
  } catch (error) {
    return failure(`cpplint check failed: ${error.message || error}`);
  }
}

/**
 * Deduplicate violations (key = file:line:category:message), keep the first 5, and build the
 * reason text (including an "N more" line). Every violation is a hard failure and must be fixed.
 * @param {Array<{file?:string, line:number, category:string, message:string}>} violations
 * @returns {string}
 * @example
 * formatViolations([{ file: 'a.cc', line: 3, category: 'whitespace/comma', message: 'Missing space' }])
 */
function formatViolations(violations) {
  const seen = new Set();
  const unique = [];
  for (const v of violations) {
    const key = `${v.file || ''}:${v.line}:${v.category}:${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }
  const shown = unique.slice(0, MAX_ERRORS_SHOWN);
  const lines = shown.map((v) => {
    const where = v.file ? `${v.file}:${v.line}` : `line ${v.line}`;
    return `  - ${where} [${v.category}] ${v.message}`;
  });
  let reason = 'cpplint found the following C++ style violations; please fix them:\n' + lines.join('\n');
  if (unique.some((v) => v.category === 'whitespace/ending_newline'
      || (v.category === 'whitespace/newline' && /Mixed LF and CRLF/.test(v.message)))) {
    reason += '\nFix line endings according to the project rules: Visual Studio source projects use CRLF, other projects follow the lineEnding setting or the existing format; for a missing final newline just add the same kind of newline. The commit check reads only the staged content, so after fixing the working tree update the index for the originally staged scope and do not overwrite unstaged changes.';
  }
  const remaining = unique.length - shown.length;
  if (remaining > 0) {
    reason += `\n  ... and ${remaining} more violation(s) not shown; fix the ones above and edit the file again to re-check`;
  }
  return reason;
}

module.exports = {
  runCpplint,
  formatViolations,
  parseCpplintOutput,
  buildFilterArg,
  MAX_ERRORS_SHOWN,
};
