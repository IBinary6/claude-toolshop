'use strict';

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

/**
 * 剥除所有前导 UTF-8 BOM。
 * @param {Buffer} buf 原始字节
 * @returns {{hadBom:boolean, body:Buffer}} hadBom=是否有前导BOM；body=无BOM正文
 */
function stripBom(buf) {
  let offset = 0;
  while (offset + 3 <= buf.length &&
         buf[offset] === 0xEF && buf[offset + 1] === 0xBB && buf[offset + 2] === 0xBF) {
    offset += 3;
  }
  return { hadBom: offset > 0, body: buf.slice(offset) };
}

/**
 * 按 hadBom 拼回恰好一个 BOM（多 BOM 已在 stripBom 归一）。
 * @param {boolean} hadBom
 * @param {Buffer} body 无 BOM 正文
 * @returns {Buffer}
 */
function restoreBom(hadBom, body) {
  return hadBom ? Buffer.concat([BOM, body]) : body;
}

/**
 * 检测编码。返回 'utf-8-bom' | 'utf-16' | 'utf-8' | 'gbk' | 'unknown'。
 * @param {Buffer} buf
 * @returns {string}
 */
function detectEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8-bom';
  if (buf.length >= 2 && ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF))) return 'utf-16';
  if (isValidUtf8(buf)) return 'utf-8';
  try {
    const iconv = require('iconv-lite');
    if (iconv.decode(buf, 'gbk').length > 0) return 'gbk';
  } catch (_) {}
  return 'unknown';
}

/** 严格 UTF-8 校验（含高位字节也能正确区分 UTF-8 与 GBK） */
function isValidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7F) { i += 1; continue; }
    let n;
    if ((b & 0xE0) === 0xC0) n = 1;
    else if ((b & 0xF0) === 0xE0) n = 2;
    else if ((b & 0xF8) === 0xF0) n = 3;
    else return false;
    if (i + n >= buf.length) return false;
    for (let j = 1; j <= n; j++) {
      if ((buf[i + j] & 0xC0) !== 0x80) return false;
    }
    i += n + 1;
  }
  return true;
}

module.exports = { stripBom, restoreBom, detectEncoding, BOM };
