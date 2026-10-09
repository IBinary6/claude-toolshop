'use strict';

const fs = require('fs');
const path = require('path');

const { readStdinJson } = require('./lib/stdin');
const { diag } = require('./lib/protocol');
const { shouldHandle } = require('./lib/target');
const { consumePendingPaths, recordPendingPaths } = require('./lib/pending_edits');
const { loadConfig } = require('./lib/config');
const { repoRoot, isNew } = require('./lib/git');
const { formatChangedFiles } = require('./lib/report');
const { ensureClangFormatConfig } = require('./lib/ensure_clang_format_config');
const { ensureProjectConfig } = require('./lib/ensure_project_config');
const { applyClangFormat } = require('./steps/clang_format');
const { applyBom } = require('./steps/bom');
const { runCpplint, formatViolations } = require('./steps/cpplint');
const { resolveLineEnding, applyLineEndings, isVisualStudioSource } = require('./lib/line_endings');

/** Below the 60s timeout in hooks.json, leaving room for output and exit; files past it are re-queued. */
const STOP_DEADLINE_MS = 45000;

function step(name, fn) {
  try {
    return fn();
  } catch (error) {
    diag(`step ${name} skipped after an error: ${error && error.message ? error.message : error}`);
    return undefined;
  }
}

function finish(payload = {}) {
  if (Object.keys(payload).length > 0) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function displayPath(filePath, root) {
  return root ? path.relative(root, filePath) : filePath;
}

/**
 * Pick the root directory used only by cpplint, so header guards in projects without Git do not
 * embed machine-specific absolute paths.
 * @param {string} filePath
 * @param {string|null} root Git root.
 * @param {string} [cwd] Hook session directory.
 * @returns {string}
 * @example
 * lintRootForFile('/p/src/a.h', null, '/p') // '/p'
 */
function lintRootForFile(filePath, root, cwd) {
  if (root) return root;

  const candidates = [cwd];
  try { candidates.push(process.cwd()); } catch (_) {}
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
      const relative = path.relative(candidate, filePath);
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        return path.resolve(candidate);
      }
    } catch (_) {}
  }
  return path.dirname(filePath);
}

/**
 * Run clang-format, BOM, line endings and cpplint on one file.
 * @param {string} filePath
 * @param {object} input Stop hook stdin JSON.
 * @returns {{changed:boolean, file:string, violations:Array<object>}|null} null when enabled=false.
 * @example
 * processFile('/p/src/a.cc', { cwd: '/p' }) // { changed: true, file: 'src/a.cc', violations: [] }
 */
function processFile(filePath, input) {
  const config = loadConfig(filePath);
  if (config.enabled === false) return null;

  const { mode, checks, legacyChecks } = config;
  const root = step('repoRoot', () => repoRoot(filePath)) || null;
  const fileIsNew = step('isNew', () => isNew(filePath, root));
  const isNewFile = fileIsNew !== false;
  // mode=full or a new file uses `checks`; a tracked file in incremental mode uses `legacyChecks`.
  const effectiveChecks = (mode === 'full' || isNewFile) ? checks : legacyChecks;
  const hasChecks = Object.values(effectiveChecks).some(Boolean);
  // Fix the target before formatting can introduce new newlines; VS projects must not follow a wrongly written LF.
  const eol = resolveLineEnding(filePath, fs.readFileSync(filePath), config, root);
  const file = displayPath(filePath, root);
  const violations = [];

  if (effectiveChecks.clangFormat && (mode === 'full' || isNewFile)) {
    step('ensure_clang_format_config', () => ensureClangFormatConfig(root));
  }
  if (hasChecks) step('ensure_project_config', () => ensureProjectConfig(root));

  let changed = false;
  if (effectiveChecks.clangFormat) {
    changed = step('clang_format', () => applyClangFormat(filePath, { isNew: isNewFile, root })) === true || changed;
  }
  // Tracked files keep their original encoding; BOM normalization is only for new files, which
  // have no historical encoding contract.
  if (isNewFile && effectiveChecks.bom) {
    changed = step('bom', () => applyBom(filePath)) === true || changed;
  }
  // Basic line-ending repair is independent of the new/old style switches and of clang-format
  // being installed, and never touches the Git index.
  try {
    changed = applyLineEndings(filePath, eol) || changed;
  } catch (error) {
    violations.push({ file, line: 0, category: 'runtime/line_endings',
      message: `Line-ending repair did not complete: ${error.message || error}` });
  }

  if (effectiveChecks.cpplint) {
    const lintRoot = lintRootForFile(filePath, root, input.cwd);
    const found = step('cpplint', () => runCpplint(filePath, {
      root: lintRoot, preserveIncludeOrder: isVisualStudioSource(filePath, root),
    })) || [];
    for (const violation of found) violations.push({ ...violation, file });
  }
  return { changed, file, violations };
}

/**
 * Stop / SubagentStop: normalize the C++ files this agent edited in the current round and block
 * once when something was rewritten or a violation remains. A follow-up run with
 * stop_hook_active=true only reports through systemMessage, which prevents a block loop.
 * @returns {Promise<void>}
 * @example
 * // stdin: {"session_id":"s","hook_event_name":"Stop","stop_hook_active":false}
 * // -> {"decision":"block","reason":"C++ style normalized 1 file(s) ..."}
 */
async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return finish();

  const filePaths = consumePendingPaths(input)
    .filter(shouldHandle)
    .filter((filePath) => {
      try { return fs.statSync(filePath).isFile(); } catch (_) { return false; }
    });
  if (filePaths.length === 0) return finish();

  const deadline = Date.now() + STOP_DEADLINE_MS;
  const changedFiles = [];
  const allViolations = [];
  const deferred = [];
  for (const filePath of filePaths) {
    if (Date.now() >= deadline) {
      deferred.push(filePath);
      continue;
    }
    const result = processFile(filePath, input);
    if (!result) continue;
    if (result.changed) changedFiles.push(result.file);
    allViolations.push(...result.violations);
  }
  if (deferred.length > 0) {
    // Put them back for the next Stop; even if re-queuing fails, report them as unchecked
    // instead of silently dropping them.
    const requeued = recordPendingPaths(input, deferred);
    for (const filePath of deferred) {
      allViolations.push({ file: filePath, line: 0, category: 'runtime/timeout',
        message: requeued ? 'Finalization ran out of time; not checked, queued for the next stop'
          : 'Finalization ran out of time; not checked and could not be queued for later' });
    }
  }

  if (changedFiles.length === 0 && allViolations.length === 0) return finish();

  const reasons = [];
  if (changedFiles.length > 0) {
    reasons.push(`C++ style was normalized for ${changedFiles.length} file(s) after this round of edits (re-read them before editing again):\n` +
      formatChangedFiles(changedFiles));
  }
  if (allViolations.length > 0) reasons.push(formatViolations(allViolations));
  reasons.push('Review the final diff, fix any remaining violations, and re-run the relevant build/tests; formatting can change include order or macro placement, so do not skip the closing check. Visual Studio source projects stay CRLF and other projects follow the lineEnding setting; a missing final newline should be added with the same kind of newline, not converted to LF.');
  const reason = reasons.join('\n\n');

  if (input.stop_hook_active) return finish({ systemMessage: reason });
  return finish({ decision: 'block', reason });
}

main().catch((error) => {
  try { diag(`stop_check top-level error: ${error && error.message ? error.message : error}`); } catch (_) {}
  finish({ systemMessage: 'The C++ style closing check failed; the C++ files edited this round were not normalized. Check them manually or confirm before committing.' });
});
