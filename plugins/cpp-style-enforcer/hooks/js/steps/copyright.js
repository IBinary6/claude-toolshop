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
 * 只识别 Copyright/Author/Date/文件名行；遇到无关行即停扫描。
 * @param {string[]} lines
 * @returns {{ copyright, author, date, relPathLine, bodyStart }}
 */
function parseHeaderBlock(lines) {
  let copyright = null, author = null, date = null, relPathLine = null;
  let lastHdrIdx = -1;

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const l = lines[i];
    if (l.startsWith(MARK_COPYRIGHT)) { copyright = l; lastHdrIdx = i; }
    else if (l.startsWith(MARK_AUTHOR)) { author = l; lastHdrIdx = i; }
    else if (l.startsWith(MARK_DATE)) { date = l; lastHdrIdx = i; }
    else if (FILENAME_LINE.test(l)) { relPathLine = l; lastHdrIdx = i; }
    else if (lastHdrIdx >= 0) break; // 非版权语义行且头块已开始 → 停止
  }

  // 头块后紧随的空行为分隔符，一并纳入，不计入正文
  const hasSeparator = lastHdrIdx >= 0 && lines[lastHdrIdx + 1] === '';
  const bodyStart = lastHdrIdx < 0 ? 0 : (hasSeparator ? lastHdrIdx + 2 : lastHdrIdx + 1);

  return { copyright, author, date, relPathLine, bodyStart };
}

/**
 * 字段级幂等版权头写入，最小化 git 变动：
 *   - Copyright / Author / 文件路径行：已有则保留原文，缺失才补充
 *   - Date：缺失则写入；已有今日日期则跳过；已有但非今日则更新
 * 全部字段均已是最新时直接返回 false，不写盘。
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
  const lines = origText.split('\n');

  const fmt = validateDateFormat(copyrightInfo.dateFormat);
  const now = new Date();
  const dateStr = formatDate(fmt, now);
  const relPath = root ? path.relative(root, filePath).replace(/\\/g, '/') : null;
  const relPathTarget = relPath ? `// ${relPath}` : null;

  const { copyright: existCopy, author: existAuthor, date: existDate,
    relPathLine: existRelPath, bodyStart } = parseHeaderBlock(lines);

  // 计算 Date 是否为今日
  let dateIsToday = false;
  if (existDate) {
    const m = existDate.match(buildDateRegex(fmt));
    dateIsToday = !!(m && m.groups &&
      m.groups.Y === String(now.getFullYear()) &&
      m.groups.M === String(now.getMonth() + 1).padStart(2, '0') &&
      m.groups.D === String(now.getDate()).padStart(2, '0'));
  }

  // 快速退出：全部字段已就绪，无需任何改动
  const allReady =
    existCopy &&
    (!author || existAuthor) &&
    existDate && dateIsToday &&
    (!relPathTarget || existRelPath);
  if (allReady) return false;

  // 计算各字段最终值（已有 → 保留；缺失 → 用新值；Date 非今日 → 更新）
  const copyLine = existCopy || `${MARK_COPYRIGHT} ${now.getFullYear()} ${company}`;
  const authorLine = existAuthor || (author ? `${MARK_AUTHOR} ${author}` : null);
  const dateLine = (existDate && dateIsToday) ? existDate : `${MARK_DATE} ${dateStr}`;
  const relLine = relPathTarget || (root ? existRelPath : null);

  const newHdrLines = [
    copyLine,
    ...(authorLine ? [authorLine] : []),
    dateLine,
    ...(relLine ? [relLine] : []),
  ];

  const bodyLines = lines.slice(bodyStart);
  const newLines = [...newHdrLines, '', ...bodyLines];

  // 尾部多余空行规范化：保留原文尾部状态
  const newText = newLines.join('\n');
  if (newText === origText) return false;

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, Buffer.from(newText, 'utf-8')));
    return true;
  } catch (_) {
    process.stderr.write('[cpp-style-enforcer] 版权头写盘失败，跳过：' + filePath + '\n');
    return false;
  }
}

module.exports = { applyCopyright, formatDate, validateDateFormat, buildDateRegex };
