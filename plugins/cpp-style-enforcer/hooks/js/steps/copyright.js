'use strict';

const fs = require('fs');
const { stripBom, restoreBom } = require('../lib/bom_util.js');

const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD HH:mm';

const MARK_COPYRIGHT = '// Copyright';
const MARK_AUTHOR = '// Author';
const MARK_DATE = '// Date';

/** 文件名行白名单：仅 C/C++ 源码后缀（buildHeader 写入的文件名行后缀必属此集） */
const FILENAME_LINE = /^\/\/ \S+\.(?:c|cc|cpp|cxx|h|hpp|hxx)\s*$/i;

/** dateFormat 必须含 YYYY/MM/DD，否则回退默认 */
function validateDateFormat(fmt) {
  if (typeof fmt !== 'string') return DEFAULT_DATE_FORMAT;
  if (fmt.includes('YYYY') && fmt.includes('MM') && fmt.includes('DD')) return fmt;
  process.stderr.write('[cpp-style-enforcer] dateFormat 缺 YYYY/MM/DD，回退默认格式\n');
  return DEFAULT_DATE_FORMAT;
}

/** 按 dateFormat 格式化日期；一次性正则交替替换，单遍命中，MM 与 mm 不互相误伤 */
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

/** 由 dateFormat 动态生成解析正则（YYYY→(?<Y>\d{4}) 等），其余字符转义为字面量 */
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
 * 插入/更新版权头。company 空 → 不写。BOM 感知（头在 BOM 之后）。
 * 同日去重：已有今日 Date 行则整次跳过。更新已有头归正错位 BOM。
 * @param {string} filePath
 * @param {{company:string, author:string, dateFormat:string}} copyrightInfo
 * @returns {boolean} 是否改写了文件
 */
function applyCopyright(filePath, copyrightInfo) {
  const { company, author } = copyrightInfo || {};
  if (!company) return false;

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);
  const text = body.toString('utf-8');

  const fmt = validateDateFormat(copyrightInfo.dateFormat);
  const now = new Date();
  const dateStr = formatDate(fmt, now);

  // 同日去重：从已有 Date 行提年月日与今天比对
  const dateRe = buildDateRegex(fmt);
  const existing = text.match(dateRe);
  if (existing && existing.groups) {
    const sameDay = existing.groups.Y === String(now.getFullYear())
      && existing.groups.M === String(now.getMonth() + 1).padStart(2, '0')
      && existing.groups.D === String(now.getDate()).padStart(2, '0');
    if (sameDay) return false; // 同天只写一次
  }

  const header = [
    `${MARK_COPYRIGHT} (c) ${now.getFullYear()} ${company}`,
    ...(author ? [`${MARK_AUTHOR} ${author}`] : []),
    `${MARK_DATE} ${dateStr}`,
    '',
  ].join('\n') + '\n';

  // 已有版权头（以 // Copyright 开头的连续注释块）→ 替换；否则前置插入
  const hasHeader = new RegExp('^\\s*' + MARK_COPYRIGHT).test(text);
  let newText;
  if (hasHeader) {
    // 仅剥离版权语义行（Copyright/Author/Date + 紧随 Date 的单个文件名行），
    // 遇普通注释/空行/代码即停，避免误删与版权块零空行粘连的用户注释
    newText = header + stripHeaderBlock(text);
  } else {
    newText = header + text;
  }
  if (newText === text) return false;

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, Buffer.from(newText, 'utf-8')));
    return true;
  } catch (_) {
    process.stderr.write('[cpp-style-enforcer] 版权头写盘失败，跳过：' + filePath + '\n');
    return false;
  }
}

/**
 * 剥离文件开头的旧版权语义行块，返回剩余文本。
 * 仅纳入 `// Copyright` / `// Author` / `// Date` 行，以及紧随 Date 行之后
 * 出现的单个文件名行（`// xxx.ext`）；遇到第一个非版权语义行（普通注释、
 * 空行、代码）即停。其后紧随的一个空行（版权头与正文的分隔）一并吃掉。
 * @param {string} text
 * @returns {string}
 */
function stripHeaderBlock(text) {
  const lines = text.split('\n');
  let i = 0;
  let lastWasDate = false;
  let fileNameTaken = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith(MARK_COPYRIGHT) || line.startsWith(MARK_AUTHOR)) {
      lastWasDate = false;
      i += 1;
    } else if (line.startsWith(MARK_DATE)) {
      lastWasDate = true;
      i += 1;
    } else if (lastWasDate && !fileNameTaken && FILENAME_LINE.test(line)) {
      // 紧随 Date 之后、仅出现一次的 C/C++ 源码文件名行视作版权头一部分
      fileNameTaken = true;
      lastWasDate = false;
      i += 1;
    } else {
      break;
    }
  }
  // 吃掉版权块后紧随的单个空行分隔
  if (i < lines.length && lines[i] === '') i += 1;
  return lines.slice(i).join('\n');
}

module.exports = { applyCopyright, formatDate, validateDateFormat, buildDateRegex };
