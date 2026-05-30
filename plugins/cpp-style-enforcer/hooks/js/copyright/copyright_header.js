#!/usr/bin/env node
/**
 * ABOUTME: PostToolUse 钩子 - C++ 版权头自动管理。
 * ABOUTME: 编辑 C++ 文件后自动插入版权头或更新 Date 时间戳。
 * ABOUTME: 版权信息运行时从 getCopyrightInfo 读取（项目配置优先，回退用户模板），各字段可缺省。
 */

const fs = require('fs');
const path = require('path');
const { readStdinJson, getCopyrightInfo } = require('../lib/utils');

// 静态列表（非用户身份信息，无需配置）
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx']);
const EXCLUDED_DIRS = new Set([
  'node_modules', 'build', 'dist', 'out', 'bin', 'obj',
  '.git', 'target', 'third_party', 'thirdparty', 'external',
  'vendor', 'deps', 'packages',
]);
const EXCLUDED_FILES = new Set(['resource.h', 'targetver.h', 'stdafx.h']);

/**
 * 从 Bash 命令中提取 C++ 文件路径
 */
function extractPathFromCommand(command) {
  if (!command || typeof command !== 'string') return null;
  const extPattern = [...CPP_EXTENSIONS].map(e => e.replace('.', '\\.')).join('|');
  const re = new RegExp(
    '(?:[A-Za-z]:[/\\\\][^\\s\'"<>|*?]+|/[^\\s\'"<>|*?]+)(?:' + extPattern + ')(?=[\\s\'";|&)>]|$)',
    'g'
  );
  const matches = command.match(re);
  return matches ? matches[0].replace(/^['"]|['"]$/g, '') : null;
}

// 版权头正则
const COPYRIGHT_RE = /^\/\/\s*[Cc]opyright\s+\d{4}/m;
// 匹配版权头块：从 Copyright 行开始，连续的 // 注释行（含紧随的空行）
const HEADER_BLOCK_RE = /^(\/\/\s*[Cc]opyright\s+\d{4}[^\r\n]*(?:\r?\n\/\/[^\r\n]*)*)(\r?\n){1,2}/m;
// 已有版权头中的 Date 行: 抓取 "YYYY/MM/DD" 前缀 (忽略时分)
const DATE_LINE_RE = /^\/\/\s*Date\s+(\d{4})\/(\d{2})\/(\d{2})\b/m;

/**
 * 格式化当前时间为 YYYY/MM/DD HH:mm
 */
function formatNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 返回今天的日期前缀 "YYYY/MM/DD", 用于"同日不更新"比对.
 */
function todayDatePrefix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/**
 * 从 hook stdin 提取文件路径（支持 Write/Edit/Bash/MCP）
 */
function resolveFilePath(input) {
  if (!input || typeof input !== 'object') return null;
  const ti = input.tool_input;
  if (typeof ti === 'object' && ti !== null) {
    const direct = ti.file_path || ti.path || null;
    if (direct) return direct;
    if (ti.relative_path) {
      const cwd = input.cwd || process.cwd();
      return path.resolve(cwd, ti.relative_path);
    }
    if (typeof ti.command === 'string') return extractPathFromCommand(ti.command);
  }
  if (typeof ti === 'string') return ti;
  return input.file_path || input.path || null;
}

/**
 * 判断文件是否需要版权头处理
 */
function shouldProcess(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CPP_EXTENSIONS.has(ext)) return false;

  const basename = path.basename(filePath).toLowerCase();
  if (EXCLUDED_FILES.has(basename)) return false;

  const parts = filePath.split(/[/\\]/);
  for (const part of parts) {
    if (EXCLUDED_DIRS.has(part.toLowerCase())) return false;
  }
  return true;
}

/**
 * 检测文件内容使用的换行风格
 */
function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * 生成版权头模板（字段可缺省）。
 *
 * 规则：
 *   - company 为空/缺失 -> 返回 null（无归属的版权头无意义，整头不写）
 *   - author 为空/缺失  -> 不写 Author 行
 *   - 其余按 "有什么写什么" 拼装
 *
 * @param {string} filename 文件名
 * @param {object|null} info { company, author } 版权信息
 * @param {string} eol 换行符
 * @returns {string|null} 版权头文本；company 缺失返回 null
 *
 * @example
 *   buildHeader('foo.cc', { company: 'Acme', author: 'a@b.com' });
 *   // => "// Copyright 2026 Acme. All rights reserved.\n// Author a@b.com\n// Date ...\n// foo.cc\n"
 *   buildHeader('foo.cc', { company: '' });  // => null
 */
function buildHeader(filename, info, eol = '\n') {
  const company = info && typeof info.company === 'string' ? info.company.trim() : '';
  if (!company) return null;  // 无归属 -> 不写头

  const author = info && typeof info.author === 'string' ? info.author.trim() : '';
  const year = new Date().getFullYear();
  const now = formatNow();
  const lines = [
    `// Copyright ${year} ${company}. All rights reserved.`,
  ];
  if (author) {
    lines.push(`// Author ${author}`);
  }
  lines.push(`// Date ${now}`);
  lines.push(`// ${filename}`);
  lines.push('');
  return lines.join(eol);
}

/**
 * 处理文件：每次都完整重写版权头
 * 使用纯字节 I/O 处理 BOM，避免字符串编码层的歧义。
 * @param {string} filePath 文件绝对路径
 * @param {object|null} info 版权信息
 * @returns {'inserted'|'updated'|'skipped'} 操作类型
 */
function processFile(filePath, info) {
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

  const raw = fs.readFileSync(filePath);

  // 剥离所有前导 BOM（无论原来有几个），记录是否有 BOM
  let offset = 0;
  while (offset + 3 <= raw.length &&
         raw[offset] === 0xef && raw[offset + 1] === 0xbb && raw[offset + 2] === 0xbf) {
    offset += 3;
  }
  const hadBom = offset > 0;

  const bodyBytes = raw.slice(offset);
  const body = bodyBytes.toString('utf-8');

  const basename = path.basename(filePath);
  const eol = detectEol(body);
  const header = buildHeader(basename, info, eol);

  // company 缺失 -> 不写版权头, 直接跳过
  if (header === null) return 'skipped';

  let newBody;
  let action;

  // 已有版权头 → 替换整个块
  if (COPYRIGHT_RE.test(body)) {
    // 同日不更新: 若 Date 行的年月日 == 今天, 整次写入跳过.
    const dm = body.match(DATE_LINE_RE);
    if (dm) {
      const existing = `${dm[1]}/${dm[2]}/${dm[3]}`;
      if (existing === todayDatePrefix()) return 'skipped';
    }
    const match = body.match(HEADER_BLOCK_RE);
    if (match) {
      newBody = body.slice(0, match.index) + header + body.slice(match.index + match[0].length);
      if (newBody === body && hadBom && offset === 3) return 'skipped';
      action = 'updated';
    } else {
      // Copyright 行存在但无法匹配完整块（格式异常）
      const cpMatch = body.match(COPYRIGHT_RE);
      newBody = body.slice(0, cpMatch.index) + header + body.slice(cpMatch.index);
      action = 'updated';
    }
  } else {
    // 无版权头 → 插入
    newBody = header + body;
    action = 'inserted';
  }

  // 写回：hadBom → 恰好 1 个 BOM + 内容字节；否则无 BOM
  const newBodyBytes = Buffer.from(newBody, 'utf-8');
  const finalBuf = hadBom ? Buffer.concat([BOM, newBodyBytes]) : newBodyBytes;
  fs.writeFileSync(filePath, finalBuf);
  return action;
}

async function main() {
  let hookInput;
  try {
    hookInput = await readStdinJson();
  } catch (e) {
    process.exit(0);
    return;
  }

  const filePath = resolveFilePath(hookInput);
  if (!filePath) {
    process.exit(0);
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    process.exit(0);
    return;
  }

  if (!shouldProcess(filePath)) {
    process.exit(0);
    return;
  }

  // 运行时读取版权信息（项目配置优先，回退用户模板）
  const info = getCopyrightInfo(filePath);

  const basename = path.basename(filePath);
  const action = processFile(filePath, info);

  if (action === 'inserted') {
    console.error(`\n  © [copyright] ${basename}: 已插入版权头`);
  } else if (action === 'updated') {
    console.error(`\n  © [copyright] ${basename}: 已更新版权头`);
  }

  process.exit(0);
}

// 导出供单测引用. 仅当作为 CLI 直接调用时才跑 main(),
// require() 加载时不触发副作用 (否则会读 stdin 阻塞测试).
module.exports = {
  processFile,
  buildHeader,
  formatNow,
  todayDatePrefix,
  shouldProcess,
};

if (require.main === module) {
  main();
}
