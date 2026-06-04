#!/usr/bin/env node
/**
 * codemap-pro SessionStart 钩子 - 智能初始化
 *
 * 职责:
 * 1. 检测 codegraph CLI 可用性 → 不可用则静默跳过
 * 2. 检测 .codegraph/codegraph.db 存在性
 *    - 不存在 → 后台 `codegraph init -i` (detached + lock)
 *    - 存在 → 跳过（MCP auto-sync 会处理增量更新）
 * 3. 所有异常静默降级，不阻塞会话
 *
 * 参考: codemap-boost/hooks/js/crg_build/crg_build.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { commandExists, isGitRepo } = require('../lib/utils');

const isWindows = process.platform === 'win32';

// 工作目录
const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 前置门禁
if (!commandExists('codegraph')) {
  // CLI 不可用 → 等用户运行 /codemap-pro-setup 显式安装。
  process.exit(0);
}

if (!isGitRepo(cwd)) {
  // 非 Git 仓库 → 静默退出
  process.exit(0);
}

// 锁机制（与 cg_worktree 共享）
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `codegraph-build-${cwdKey}.lock`);
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4小时

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function isBuildLockActive() {
  try {
    const pidStr = fs.readFileSync(buildLockFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10) || 0;
    const st = fs.statSync(buildLockFile);

    // PID 死了 或 mtime 超 4h → 清陈旧锁
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS || !isPidAlive(pid)) {
      try {
        fs.unlinkSync(buildLockFile);
      } catch (e) {}
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function tryAcquireBuildLock() {
  try {
    fs.writeFileSync(buildLockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    return false;
  }
}

// 检测 .codegraph/codegraph.db 是否存在
const dbFile = path.join(cwd, '.codegraph', 'codegraph.db');

if (fs.existsSync(dbFile)) {
  // DB 已存在 → 跳过初始化
  // MCP Server 的 auto-sync (2s 去抖) 会处理增量更新
  process.exit(0);
}

// DB 不存在 → 需要初始化
// 检查 build lock
if (isBuildLockActive()) {
  // 已有 build 在跑 → 跳过
  process.exit(0);
}

// 尝试获取 build lock
if (!tryAcquireBuildLock()) {
  // 获取锁失败（竞争失败）→ 跳过
  process.exit(0);
}

// 后台 build - 用 wrapper 进程包裹确保锁释放
const logDir = path.join(cwd, '.codegraph', 'logs');
try {
  fs.mkdirSync(logDir, { recursive: true });
} catch (_) {}

const logFile = path.join(logDir, `init-${Date.now()}.log`);

const wrapperCode = `
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  let out;
  try {
    out = fs.openSync(${JSON.stringify(logFile)}, 'a');
    // codegraph init -i = init + index
    spawnSync('codegraph', ['init', '-i', ${JSON.stringify(cwd)}], {
      stdio: ['ignore', out, out],
      windowsHide: ${isWindows},
    });
  } catch (e) {
  } finally {
    if (typeof out === 'number') {
      try {
        fs.closeSync(out);
      } catch (e) {}
    }
    try {
      fs.unlinkSync(${JSON.stringify(buildLockFile)});
    } catch (e) {}
  }
`;

try {
  const proc = spawn(process.execPath, ['-e', wrapperCode], {
    cwd,
    detached: true,
    windowsHide: isWindows,
    stdio: 'ignore',
    env: process.env
  });
  proc.unref();
} catch (_) {
  try {
    fs.unlinkSync(buildLockFile);
  } catch (_) {}
}

process.exit(0);
