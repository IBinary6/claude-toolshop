'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Only the project markers in the file's ancestor directories are checked; other projects in the same repository and build directories are not scanned recursively.
 * The nearest CMake source directory wins over an outer solution; CMake-generated directories are not treated as native VS projects.
 * @param {string} filePath The edited file.
 * @param {string|null} [root] Upper bound for the upward search (the Git root).
 * @returns {boolean}
 * @example
 * isVisualStudioSource('D:/proj/src/a.cpp', 'D:/proj') // true when an ancestor directory has .sln/.vcxproj
 */
function isVisualStudioSource(filePath, root = null) {
  let dir = path.dirname(path.resolve(filePath));
  let boundary = root ? path.resolve(root) : null;
  // The Windows Git root may be a long path while TEMP/callers use 8.3 paths; unify them before comparing the boundary.
  try { dir = fs.realpathSync(dir); } catch (_) {}
  if (boundary) { try { boundary = fs.realpathSync(boundary); } catch (_) {} }
  while (true) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) {}
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase());
    if (names.includes('cmakelists.txt')) return false;
    const generated = names.includes('cmakecache.txt')
      || entries.some((entry) => entry.isDirectory() && entry.name === 'CMakeFiles');
    if (!generated && names.some((name) => /\.(?:vcxproj|vcproj|sln|slnx)$/.test(name))) return true;
    const parent = path.dirname(dir);
    if (dir === boundary || parent === dir) return false;
    dir = parent;
  }
}

/**
 * Map the text body to a string whose line endings can be handled safely, while keeping the encoding and the original BOM bytes.
 * UTF-32 / unknown encodings containing NUL return null, and callers must not rewrite such files.
 * @param {Buffer} raw
 * @returns {{text:string, encode:function(string):Buffer}|null}
 * @example
 * textView(Buffer.from('a\r\n')).text // 'a\r\n'
 */
function textView(raw) {
  // The UTF-32LE BOM starts with the UTF-16LE BOM; unsupported encodings must be excluded before the UTF-16 branch.
  if (raw.length >= 4 && (raw.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0]))
      || raw.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff])))) return null;
  if (raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe)
      || (raw[0] === 0xfe && raw[1] === 0xff))) {
    if (raw.length % 2 !== 0) return null;
    const bigEndian = raw[0] === 0xfe;
    const body = Buffer.from(raw.subarray(2));
    if (bigEndian) body.swap16();
    return {
      text: body.toString('utf16le'),
      encode(text) {
        const bytes = Buffer.from(text, 'utf16le');
        if (bigEndian) bytes.swap16();
        return Buffer.concat([raw.subarray(0, 2), bytes]);
      },
    };
  }
  // Content containing NUL without a declared encoding is not treated as single-byte source, to avoid corrupting UTF-16/binary files.
  if (raw.includes(0)) return null;
  const offset = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 3 : 0;
  return {
    text: raw.subarray(offset).toString('latin1'),
    encode: (text) => Buffer.concat([raw.subarray(0, offset), Buffer.from(text, 'latin1')]),
  };
}

/**
 * Without an explicit policy keep the majority line ending; on a tie use the first one, and with no line endings use LF.
 * @param {Buffer} raw
 * @returns {string} '\r\n' or '\n'
 * @example
 * existingLineEnding(Buffer.from('a\r\nb\r\nc\n')) // '\r\n'
 */
function existingLineEnding(raw) {
  const view = textView(raw);
  const endings = view ? view.text.match(/\r\n|\n|\r/g) || [] : [];
  const crlf = endings.filter((eol) => eol === '\r\n').length;
  const lf = endings.length - crlf;
  if (crlf === lf) return endings[0] === '\r\n' ? '\r\n' : '\n';
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * Visual Studio source projects are forced to CRLF; other projects follow the config or the body style read before the edit.
 * @param {string} filePath
 * @param {Buffer} raw The file bytes before processing.
 * @param {{lineEnding?:string}} [config]
 * @param {string|null} [root]
 * @returns {string} '\r\n' or '\n'
 * @example
 * resolveLineEnding('/p/a.cpp', Buffer.from('x\n'), { lineEnding: 'crlf' }) // '\r\n'
 */
function resolveLineEnding(filePath, raw, config = {}, root = null) {
  if (isVisualStudioSource(filePath, root)) return '\r\n';
  if (config.lineEnding === 'crlf') return '\r\n';
  if (config.lineEnding === 'lf') return '\n';
  return existingLineEnding(raw);
}

/**
 * Only replace line-ending bytes and add the final newline to a non-empty body; existing blank lines are kept and nothing is transcoded or has its BOM changed.
 * @param {Buffer} raw
 * @param {string} eol '\r\n' or '\n'
 * @returns {Buffer}
 * @example
 * normalizeLineEndings(Buffer.from('a\nb'), '\r\n').toString() // 'a\r\nb\r\n'
 */
function normalizeLineEndings(raw, eol) {
  if (eol !== '\r\n' && eol !== '\n') throw new Error('Invalid line ending');
  const view = textView(raw);
  if (!view || !view.text) return raw;
  let text = view.text.replace(/\r\n|\n|\r/g, eol);
  if (!text.endsWith(eol)) text += eol;
  return view.encode(text);
}

/**
 * Final line-ending repair, independent of clang-format; nothing is written when the file already complies.
 * @param {string} filePath
 * @param {string} eol '\r\n' or '\n'
 * @returns {boolean} Whether the file was written.
 * @example
 * applyLineEndings('/p/a.cpp', '\r\n') // true when something changed
 */
function applyLineEndings(filePath, eol) {
  const raw = fs.readFileSync(filePath);
  const normalized = normalizeLineEndings(raw, eol);
  if (normalized.equals(raw)) return false;
  fs.writeFileSync(filePath, normalized);
  return true;
}

module.exports = { isVisualStudioSource, existingLineEnding, resolveLineEnding, normalizeLineEndings, applyLineEndings };
