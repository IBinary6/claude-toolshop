'use strict';

const { requireIconv } = require('./ensure_deps.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);          // UTF-8 BOM
const UTF16LE_BOM = Buffer.from([0xFF, 0xFE]);         // UTF-16 LE BOM
const UTF16BE_BOM = Buffer.from([0xFE, 0xFF]);         // UTF-16 BE BOM

/**
 * Strip every leading UTF-8 BOM.
 * @param {Buffer} buf The original bytes.
 * @returns {{hadBom:boolean, body:Buffer}} hadBom = whether a leading BOM was present; body = the content without BOM.
 */
function stripBom(buf) {
  let offset = 0;
  while (offset + BOM.length <= buf.length &&
         buf[offset] === BOM[0] && buf[offset + 1] === BOM[1] && buf[offset + 2] === BOM[2]) {
    offset += BOM.length;
  }
  // Buffer.from(subarray) copies into independent memory so it does not share the underlying buffer with the original (including the offset=0 branch)
  return { hadBom: offset > 0, body: Buffer.from(buf.subarray(offset)) };
}

/**
 * Re-attach exactly one BOM according to hadBom (multiple BOMs were already normalized by stripBom).
 * @param {boolean} hadBom
 * @param {Buffer} body The content without BOM.
 * @returns {Buffer}
 */
function restoreBom(hadBom, body) {
  return hadBom ? Buffer.concat([BOM, body]) : body;
}

/**
 * Detect the encoding. Returns 'utf-8-bom' | 'utf-16' | 'utf-8' | 'gbk' | 'unknown'.
 * @param {Buffer} buf
 * @returns {string}
 */
function detectEncoding(buf) {
  if (buf.length >= BOM.length && buf[0] === BOM[0] && buf[1] === BOM[1] && buf[2] === BOM[2]) return 'utf-8-bom';
  if (buf.length >= 2 &&
      ((buf[0] === UTF16LE_BOM[0] && buf[1] === UTF16LE_BOM[1]) ||
       (buf[0] === UTF16BE_BOM[0] && buf[1] === UTF16BE_BOM[1]))) return 'utf-16';
  if (isValidUtf8(buf)) return 'utf-8';
  try {
    const iconv = requireIconv();              // Resolved ROOT -> DATA (belt and braces); null when missing
    // gbk is the fallback classification: iconv can decode most byte sequences, so it is not guaranteed to be exact
    if (iconv && iconv.decode(buf, 'gbk').length > 0) return 'gbk';
  } catch (_) {}
  return 'unknown';
}

/** Strict UTF-8 validation (also tells UTF-8 and GBK apart correctly when high bytes are present) */
function isValidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7F) { i += 1; continue; }
    let n;
    if ((b & 0xE0) === 0xC0) n = 1;        // 110xxxxx -> 2-byte sequence
    else if ((b & 0xF0) === 0xE0) n = 2;   // 1110xxxx -> 3-byte sequence
    else if ((b & 0xF8) === 0xF0) n = 3;   // 11110xxx -> 4-byte sequence
    else return false;
    if (i + n >= buf.length) return false;
    for (let j = 1; j <= n; j++) {
      if ((buf[i + j] & 0xC0) !== 0x80) return false;   // continuation bytes must be 10xxxxxx
    }
    i += n + 1;
  }
  return true;
}

module.exports = { stripBom, restoreBom, detectEncoding, BOM };
