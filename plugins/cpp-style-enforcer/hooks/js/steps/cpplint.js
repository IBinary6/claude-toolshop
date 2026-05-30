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
 * 在临时副本上跑 cpplint（不写回原文件）。
 * 读磁盘文件 → stripBom 去 BOM → 写临时副本
 * os.tmpdir()/cpp-style-enforcer/<projHash>/<relPathHash>-<basename>
 * （相对仓库根路径 hash 做前缀防同名文件碰撞）→ spawnSync python cpplint.py
 * → 解析 stderr 违规 → 原文件全程不写回 → 删临时副本 → 返回违规数组。
 * @param {string} filePath
 * @param {{root?:string, suppressCopyright?:boolean}} options
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
  if (options.suppressCopyright) args.push('--filter=-legal/copyright');
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
  }
  return violations;
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

module.exports = { runCpplint, formatViolations, parseCpplintOutput, MAX_ERRORS_SHOWN };
