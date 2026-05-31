'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { stripBom } = require('../lib/bom_util.js');

const isWindows = process.platform === 'win32';
const MAX_ERRORS_SHOWN = 5;
const CPPLINT_PY = path.join(__dirname, '..', 'cpplint', 'cpplint.py');

// 风格类「软违规」：建议而非强制。
// - build/include_subdir：相对 include 路径习惯因项目而异，硬改可能破坏编译。
// - build/header_guard：clang-format 管不了，是真违规，但 guard 命名/可改用 #pragma once，故仅建议。
// 新架构下（新文件先 Google 整文件格式化再 cpplint）clang-format 已对齐 include_order /
// indent_namespace / comments，cpplint 恒不报，无需 filter 防互搏。
const SOFT_CATEGORIES = new Set(['build/include_subdir', 'build/header_guard']);

/** 解析 python 可执行（python / python3），都没有返回 null */
function resolvePython() {
  for (const cmd of ['python', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe', windowsHide: isWindows });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

function shortHash(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 8);
}

/** 解析 cpplint stderr：`path:line:  message  [category] [conf]` → {line,category,message} */
function parseCpplintOutput(out) {
  const violations = [];
  const re = /^.*?:(\d+):\s+(.*?)\s+\[([^\]]+)\](?:\s+\[\d+\])?\s*$/;
  for (const raw of String(out).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    violations.push({ line: parseInt(m[1], 10), message: m[2].trim(), category: m[3].trim() });
  }
  return violations;
}

/**
 * 合并 filter：按需 -legal/copyright + 调用方额外项，去重后拼成单个逗号分隔的 --filter 值
 * （cpplint 只接受一个 --filter）。无任何 filter 项时返回 null，由调用方决定不传 --filter。
 * @param {{suppressCopyright?:boolean, extraFilters?:string[]}} options
 * @returns {string|null}
 */
function buildFilterArg(options = {}) {
  const filters = [];
  if (options.suppressCopyright) filters.push('-legal/copyright');
  if (Array.isArray(options.extraFilters)) filters.push(...options.extraFilters);
  const uniq = [];
  const seen = new Set();
  for (const f of filters) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    uniq.push(f);
  }
  if (uniq.length === 0) return null;
  return '--filter=' + uniq.join(',');
}

/**
 * 在临时副本上跑 cpplint（不写回原文件）。
 * 读磁盘文件 → stripBom 去 BOM → 写临时副本
 * os.tmpdir()/cpp-style-enforcer/<projHash>/<relPathHash>-<basename>
 * （相对仓库根路径 hash 做前缀防同名文件碰撞）→ spawnSync python cpplint.py
 * → 解析 stderr 违规 → 原文件全程不写回 → 删临时副本 → 返回违规数组。
 * filter 仅在 suppressCopyright 时含 -legal/copyright；无 filter 项时不传 --filter。
 * @param {string} filePath
 * @param {{root?:string, suppressCopyright?:boolean, extraFilters?:string[]}} options
 * @returns {Array<{line:number, category:string, message:string}>}
 */
function runCpplint(filePath, options = {}) {
  const python = resolvePython();
  if (!python || !fs.existsSync(CPPLINT_PY)) {
    process.stderr.write('[cpp-style-enforcer] python/cpplint 不可用，跳过 cpplint\n');
    return [];
  }

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return []; }
  const { body } = stripBom(raw);

  const root = options.root || path.dirname(filePath);
  let rel;
  try { rel = path.relative(root, filePath); } catch (_) { rel = path.basename(filePath); }
  const projHash = shortHash(root);
  const relHash = shortHash(rel);
  const tmpDir = path.join(os.tmpdir(), 'cpp-style-enforcer', projHash);
  const tmpFile = path.join(tmpDir, `${relHash}-${path.basename(filePath)}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, body);
  } catch (_) {
    return [];
  }

  const args = [CPPLINT_PY, '--quiet'];
  const filterArg = buildFilterArg(options);
  if (filterArg) args.push(filterArg);
  args.push(tmpFile);

  let violations = [];
  try {
    const r = spawnSync(python, args, {
      stdio: 'pipe',
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: isWindows,
    });
    const stderr = (r.stderr || Buffer.alloc(0)).toString('utf-8');
    violations = parseCpplintOutput(stderr);
  } catch (_) {
    violations = [];
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    // 删完临时副本后尝试清理空的 <projHash> 目录，避免在 %TEMP% 无界累积。
    // rmdirSync 仅当目录已空才成功；非空（并发其它副本）/权限失败均安全忽略。
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  }
  return violations;
}

/**
 * 按软/硬分类违规。软违规为 build/include_subdir 与 build/header_guard（建议而非强制）。
 * @param {Array<{line:number, category:string, message:string}>} violations
 * @returns {{hard:Array, soft:Array}}
 */
function splitViolations(violations) {
  const hard = [];
  const soft = [];
  for (const v of violations) {
    if (SOFT_CATEGORIES.has(v.category)) soft.push(v);
    else hard.push(v);
  }
  return { hard, soft };
}

/**
 * 逐字去重（key=line:category:message）→ 取前 5 → 拼 reason（含「还有 N 条」）。
 * @param {Array<{line:number, category:string, message:string}>} violations
 * @returns {string}
 */
function formatViolations(violations) {
  const seen = new Set();
  const unique = [];
  for (const v of violations) {
    const key = `${v.line}:${v.category}:${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }
  const shown = unique.slice(0, MAX_ERRORS_SHOWN);
  const lines = shown.map((v) => `  - 行 ${v.line} [${v.category}] ${v.message}`);
  let reason = 'cpplint 检测到以下 C++ 风格违规，请修复：\n' + lines.join('\n');
  const remaining = unique.length - shown.length;
  if (remaining > 0) {
    reason += `\n  ... 还有 ${remaining} 条违规未显示，修复以上后重新编辑该文件以重新检查`;
  }
  return reason;
}

/**
 * 软违规（include_subdir / header_guard）的建议性文案：建议改进但允许按项目习惯保留，由调用方判断。
 * 复用 blockClaude 出口，仅文案区别于硬违规的「必须修复」。
 * @param {Array<{line:number, category:string, message:string}>} violations
 * @returns {string}
 */
function formatSoftViolations(violations) {
  const seen = new Set();
  const unique = [];
  for (const v of violations) {
    const key = `${v.line}:${v.category}:${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }
  const shown = unique.slice(0, MAX_ERRORS_SHOWN);
  const lines = shown.map((v) => `  - 行 ${v.line} [${v.category}] ${v.message}`);
  let reason = 'cpplint 提示以下 C++ 风格（建议项，非强制）：\n' + lines.join('\n');
  const remaining = unique.length - shown.length;
  if (remaining > 0) {
    reason += `\n  ... 还有 ${remaining} 条未显示`;
  }
  reason += '\n建议：include 可改为完整目录前缀；头文件建议补 include guard 或改用 #pragma once。'
    + '若与本项目构建/include 习惯冲突，可保留现状。请自行判断后继续，无需强制修改。';
  return reason;
}

module.exports = {
  runCpplint,
  formatViolations,
  formatSoftViolations,
  splitViolations,
  parseCpplintOutput,
  buildFilterArg,
  SOFT_CATEGORIES,
  MAX_ERRORS_SHOWN,
};
