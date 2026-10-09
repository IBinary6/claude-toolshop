'use strict';

const fs = require('fs');
const { detectEncoding, BOM } = require('../lib/bom_util.js');
const { requireIconv } = require('../lib/ensure_deps.js');

/**
 * Add a UTF-8 BOM, or transcode GBK and add a BOM. Nothing is written when the content does not change.
 * @param {string} filePath
 * @param {{isCMake?:boolean}} options Kept for compatibility with old callers; CMake no longer skips the BOM.
 * @returns {boolean} Whether the file was rewritten.
 */
function applyBom(filePath, options = {}) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (_) { return false; }

  // Empty file -> write only the BOM
  if (buf.length === 0) {
    try { fs.writeFileSync(filePath, BOM); return true; } catch (_) { return false; }
  }

  const enc = detectEncoding(buf);
  // Leave alone: an existing BOM / UTF-16 / an encoding that cannot be confirmed (unknown).
  // unknown is mostly GBK that degraded because iconv-lite is missing at run time; forcing a UTF-8 BOM there would produce
  // a broken file of EF BB BF + the original bytes and damage a file that used to open fine.
  if (enc === 'utf-8-bom' || enc === 'utf-16' || enc === 'unknown') return false;

  if (enc === 'gbk') {
    try {
      const iconv = requireIconv();            // Belt-and-braces resolution ROOT -> DATA
      if (!iconv) return false;                // iconv missing -> skip, do not crash
      const text = iconv.decode(buf, 'gbk');
      const out = Buffer.concat([BOM, Buffer.from(text, 'utf-8')]);
      fs.writeFileSync(filePath, out);
      return true;
    } catch (_) {
      return false; // iconv missing -> skip, do not crash
    }
  }

  // Add a BOM only to confirmed utf-8 (no BOM)
  try {
    fs.writeFileSync(filePath, Buffer.concat([BOM, buf]));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyBom };
