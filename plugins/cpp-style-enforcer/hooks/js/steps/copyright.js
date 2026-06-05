'use strict';

const fs = require('fs');
const path = require('path');
const { stripBom, restoreBom } = require('../lib/bom_util.js');

const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD HH:mm';

const MARK_COPYRIGHT = '// Copyright';
const MARK_AUTHOR = '// Author';
const MARK_DATE = '// Date';

/** 文件名行白名单：// 开头后跟相对路径（含目录斜线或纯文件名带 C/C++ 后缀） */
const FILENAME_LINE = /^\/\/ \S+\.(?:c|cc|cpp|cxx|h|hpp|hxx)\s*$/i;

/**
 * 宽松扫描文件前 maxLines 行，检测是否存在任何版权/许可证内容。
 * 不限注释风格（// /* # 等），覆盖外来格式版权头。
 * 用于防止在非标准版权头上方叠加我们的标准头。
 *
 * @param {string[]} lines
 * @param {number} [maxLines=25]
 * @returns {boolean}
 */
function hasAnyCopyrightContent(lines, maxLines = 25) {
  // 匹配常见版权/许可证关键词，不区分大小写
  const re = /copyright|licence|license|spdx|©|\(c\)\s*\d/i;
  const limit = Math.min(lines.length, maxLines);
  for (let i = 0; i < limit; i++) {
    if (re.test(lines[i])) return true;
  }
  return false;
}

function validateDateFormat(fmt) {
  if (typeof fmt !== 'string') return DEFAULT_DATE_FORMAT;
  if (fmt.includes('YYYY') && fmt.includes('MM') && fmt.includes('DD')) return fmt;
  process.stderr.write('[cpp-style-enforcer] dateFormat 缺 YYYY/MM/DD，回退默认格式\n');
  return DEFAULT_DATE_FORMAT;
}

function formatDate(fmt, d) {
  const tokens = {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0'),
    HH: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (m) => tokens[m]);
}

function buildDateRegex(fmt) {
  let re = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt.startsWith('YYYY', i)) { re += '(?<Y>\\d{4})'; i += 4; }
    else if (fmt.startsWith('MM', i)) { re += '(?<M>\\d{2})'; i += 2; }
    else if (fmt.startsWith('DD', i)) { re += '(?<D>\\d{2})'; i += 2; }
    else if (fmt.startsWith('HH', i)) { re += '\\d{2}'; i += 2; }
    else if (fmt.startsWith('mm', i)) { re += '\\d{2}'; i += 2; }
    else { re += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; }
  }
  return new RegExp(MARK_DATE + ' ' + re);
}

/**
 * 解析文件顶部的版权头块，提取各语义行和正文起始位置。
 *
 * 头块定义为文件顶部第一个连续注释区（允许行首空白、跳过最顶空行）。
 * 区内识别 Copyright/Author/Date/文件名 四类语义行：
 *   - 各类仅取首次出现，重复出现的语义行丢弃（根除版权头重复追加）；
 *   - 语义行之间夹的空行视为头内分隔，不保留也不中断扫描；
 *   - 紧邻语义行的非语义注释行收入 extraComments 原样保留；
 *   - 空行之后再出现的注释视为正文文档注释，头块到此结束。
 * 若连续注释区内无任何语义行，判定文件无版权头，全部归还正文（bodyStart=0）。
 *
 * @param {string[]} lines 已按行分割（行尾 \r 已剥离）的文本行
 * @returns {{copyright, author, date, relPathLine, bodyStart, extraComments:string[]}}
 */
function parseHeaderBlock(lines) {
  let copyright = null, author = null, date = null, relPathLine = null;
  const extraComments = [];
  let sawSemantic = false;
  let pendingBlank = 0;

  let i = 0;
  while (i < lines.length && lines[i].replace(/^\s+/, '') === '') i++; // 跳过最顶空行

  for (; i < lines.length; i++) {
    const l = lines[i].replace(/^\s+/, ''); // 容忍行首空白
    if (l === '') { pendingBlank++; continue; }
    if (!l.startsWith('//')) break; // 代码行 → 头块结束

    const isSemantic =
      l.startsWith(MARK_COPYRIGHT) || l.startsWith(MARK_AUTHOR) ||
      l.startsWith(MARK_DATE) || FILENAME_LINE.test(l);

    if (!isSemantic) {
      if (pendingBlank > 0) break; // 空行后的注释 → 正文文档注释，头块结束（不消费此行）
      extraComments.push(lines[i]); // 紧邻语义行的注释 → 头内夹注释，原样保留
      continue;
    }

    // 语义行：清空待定空行（头内分隔不保留），各类仅取首次
    pendingBlank = 0;
    sawSemantic = true;
    if (l.startsWith(MARK_COPYRIGHT)) { if (!copyright) copyright = l; }
    else if (l.startsWith(MARK_AUTHOR)) { if (!author) author = l; }
    else if (l.startsWith(MARK_DATE)) { if (!date) date = l; }
    else if (!relPathLine) relPathLine = l;
  }

  if (!sawSemantic) {
    return { copyright: null, author: null, date: null, relPathLine: null, bodyStart: 0, extraComments: [] };
  }
  // i 指向头块结束位置（代码行 / 空行后的注释行 / 文件末尾）；其后行均为正文
  return { copyright, author, date, relPathLine, bodyStart: i, extraComments };
}

/**
 * 字段级幂等版权头写入，最小化 git 变动：
 *   - Copyright / Author / Date / 文件路径行：已有则保留原文，缺失才补充，绝不覆盖。
 *   - 重复语义行去重、头内夹注释保留，重建后与原文全等则不写盘。
 *
 * @param {string} filePath
 * @param {{company:string, author:string, dateFormat:string}} copyrightInfo
 * @param {string|null} [root] git 仓库根（用于生成文件相对路径行）
 * @returns {boolean} 是否写盘
 */
function applyCopyright(filePath, copyrightInfo, root) {
  const { company, author } = copyrightInfo || {};
  if (!company) return false;

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);
  const origText = body.toString('utf-8');
  const eol = origText.includes('\r\n') ? '\r\n' : '\n'; // 保持原行尾风格
  const lines = origText.split(/\r?\n/); // 剥离行尾 \r，统一按内容比对

  const fmt = validateDateFormat(copyrightInfo.dateFormat);
  const now = new Date();
  const dateStr = formatDate(fmt, now);
  const relPath = root ? path.relative(root, filePath).replace(/\\/g, '/') : null;
  const relPathTarget = relPath ? `// ${relPath}` : null;

  const { copyright: existCopy, author: existAuthor, date: existDate,
    relPathLine: existRelPath, bodyStart, extraComments } = parseHeaderBlock(lines);

  // 外来格式版权头保护：文件前 25 行检测到版权关键词但没有我们的标准 // Copyright 行
  // → 格式千变万化（/* */、(c)、SPDX 等），直接跳过，原文不动，防止双头叠加。
  if (!existCopy && hasAnyCopyrightContent(lines)) return false;

  // Copyright：已有则保留（年份/公司不覆盖），缺失才补充
  // Author：配置了就用配置值（替换原来别人的），未配置则保留原文
  // Date：一旦写入永不刷新（保留文件首次创建时间）
  const copyLine = existCopy || `${MARK_COPYRIGHT} ${now.getFullYear()} ${company}`;
  const authorLine = author ? `${MARK_AUTHOR} ${author}` : existAuthor;
  const dateLine = existDate || `${MARK_DATE} ${dateStr}`;
  const relLine = relPathTarget || (root ? existRelPath : null);

  const newHdrLines = [
    copyLine,
    ...(authorLine ? [authorLine] : []),
    dateLine,
    ...(relLine ? [relLine] : []),
  ];

  // 头内夹注释（extraComments）保留在头部之后、正文之前
  const bodyLines = lines.slice(bodyStart);
  const newLines = [...newHdrLines, ...extraComments, '', ...bodyLines];

  // 始终重建后与原文比对：规范且就绪 → 全等不写盘；含重复/夹注释 → 写盘清理。
  // 用原行尾风格还原（CRLF 文件不被改成 LF）。
  const newText = newLines.join(eol);
  if (newText === origText) return false;

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, Buffer.from(newText, 'utf-8')));
    return true;
  } catch (_) {
    process.stderr.write('[cpp-style-enforcer] 版权头写盘失败，跳过：' + filePath + '\n');
    return false;
  }
}

module.exports = { applyCopyright, formatDate, validateDateFormat, buildDateRegex, parseHeaderBlock, hasAnyCopyrightContent };
