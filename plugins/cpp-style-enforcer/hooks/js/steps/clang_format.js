'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripBom, restoreBom } = require('../lib/bom_util.js');
const { changedLineRanges } = require('../lib/git.js');
const { detectClangFormat } = require('../lib/ensure_deps.js');
const { isVisualStudioSource } = require('../lib/line_endings.js');

const isWindows = process.platform === 'win32';

/**
 * Restore the line-ending style of the formatted output to that of the source.
 *
 * Some clang-format versions / BasedOnStyle presets emit CRLF input as LF (a DeriveLineEnding
 * difference). VS project sources are mostly CRLF, and silently turning them into LF makes git diff every line of the file.
 * This does not depend on any clang-format setting: it forces the input's line endings back, covering all versions and existing projects.
 *
 * Implementation: normalize the output to LF through latin1 (byte-safe), then restore CRLF when the source style is CRLF.
 * The two-way latin1 mapping leaves UTF-8 multi-byte sequences intact, and replace only touches \r(0x0D)\n(0x0A).
 *
 * @param {Buffer} formatted The bytes clang-format produced.
 * @param {Buffer} source The input body without BOM (the line-ending baseline).
 * @returns {Buffer} Output whose line endings match the source.
 */
function matchLineEnding(formatted, source) {
  const sourceCRLF = source.includes('\r\n');
  let s = formatted.toString('latin1').replace(/\r\n/g, '\n'); // Normalize to LF
  if (sourceCRLF) s = s.replace(/\n/g, '\r\n');                // Restore CRLF
  return Buffer.from(s, 'latin1');
}

/**
 * BOM-aware, two-mode clang-format.
 * Strip the BOM -> feed the BOM-free body to clang-format through stdin (stdout) -> diff against the BOM-free body
 * -> write back with restoreBom only when it changed. A missing or failing clang-format silently returns false. No -i.
 *
 * Modes (chosen by opts.isNew; the default is a new file):
 * - New file: format the whole file with -style=file -fallback-style=Google; Visual Studio projects keep include
 *   order, other projects use the project's sort setting. Existing local clang-format off/on guards keep working.
 * - Old file: format only the lines git changed (--lines=s:e), read the project style and turn include sorting off;
 *   with no changed lines nothing is formatted and false is returned.
 *
 * About line numbers: --lines applies to the stdin input (the body with BOM removed). Removing the BOM only drops the first
 * 3 bytes of the file (the BOM sits at the start of line 1 and adds or removes no lines), so git diff line numbers can be used for --lines directly.
 *
 * @param {string} filePath
 * @param {{isNew?:boolean, root?:string|null, detect?:function():({cmd:string,args:string[]}|null)}} [opts]
 * @returns {boolean} Whether the file was rewritten.
 */
function applyClangFormat(filePath, opts) {
  const isNew = !opts || opts.isNew !== false; // Default -> new file, whole-file mode
  const root = opts && opts.root ? opts.root : null;
  // Detect only, never install: the edit hook must not pip-install, which could block or time out.
  const detect = (opts && opts.detect) || detectClangFormat;
  let desc = null;
  try { desc = detect(); } catch (_) { desc = null; }
  if (!desc) return false; // clang-format unavailable -> degrade silently

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);

  let args;
  if (isNew) {
    args = ['-style=file', '-fallback-style=Google', `-assume-filename=${filePath}`];
    // VS headers can depend on earlier types/macros, so include order must not be rearranged just because the file is not committed yet.
    if (isVisualStudioSource(filePath, root)) args.push('--sort-includes=false');
  } else {
    const ranges = changedLineRanges(filePath, root);
    if (!ranges || ranges.length === 0) return false; // No changed lines -> do not format
    args = ['-style=file', '-fallback-style=Google', '--sort-includes=false', `-assume-filename=${filePath}`];
    for (const [s, e] of ranges) args.push(`--lines=${s}:${e}`);
  }

  const r = spawnSync(
    desc.cmd,
    [...desc.args, ...args],
    { input: body, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 32 * 1024 * 1024, windowsHide: isWindows }
  );
  // clang-format failed -> skip silently
  if (r.error || r.status !== 0 || !r.stdout) return false;

  const rawFormatted = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
  // Restore the input's line endings (prevents clang-format from turning CRLF into LF and diffing the whole file)
  const formatted = matchLineEnding(rawFormatted, body);
  if (formatted.equals(body)) return false; // Still unchanged after restoring line endings -> do not write

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, formatted));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyClangFormat, matchLineEnding };
