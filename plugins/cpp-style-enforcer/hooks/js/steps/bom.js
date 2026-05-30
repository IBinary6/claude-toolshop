'use strict';

const fs = require('fs');
const { detectEncoding, BOM } = require('../lib/bom_util.js');

/**
 * 补 UTF-8 BOM / GBK 转码加 BOM。内容无变化不写。
 * CMake 项目（isCMake=true）整体跳过。
 * @param {string} filePath
 * @param {{isCMake?:boolean}} options
 * @returns {boolean} 是否改写了文件
 */
function applyBom(filePath, options = {}) {
  if (options.isCMake) return false;
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (_) { return false; }

  // 空文件 → 只写 BOM
  if (buf.length === 0) {
    try { fs.writeFileSync(filePath, BOM); return true; } catch (_) { return false; }
  }

  const enc = detectEncoding(buf);
  if (enc === 'utf-8-bom') return false;      // 已有 BOM → 不写
  if (enc === 'utf-16') return false;          // UTF-16 → 跳过

  if (enc === 'gbk') {
    try {
      const iconv = require('iconv-lite');
      const text = iconv.decode(buf, 'gbk');
      const out = Buffer.concat([BOM, Buffer.from(text, 'utf-8')]);
      fs.writeFileSync(filePath, out);
      return true;
    } catch (_) {
      return false; // iconv 缺失 → 跳过，不崩
    }
  }

  // utf-8（无 BOM）或 unknown → 补 BOM
  try {
    fs.writeFileSync(filePath, Buffer.concat([BOM, buf]));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyBom };
