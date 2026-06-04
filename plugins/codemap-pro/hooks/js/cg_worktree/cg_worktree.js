#!/usr/bin/env node
/**
 * codemap-pro EnterWorktree 钩子 - worktree 环境处理
 *
 * 职责:
 * 1. 检测 worktree 的 .codegraph/codegraph.db 存在性
 *    - 不存在 → 后台 `codegraph init -i`
 *    - 存在 → 后台 `codegraph sync`（增量更新）
 * 2. 所有异常静默降级，不阻塞会话
 *
 * 参考: codemap-boost/hooks/js/crg_worktree/crg_worktree.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { commandExists, isGitRepo } = require('../lib/utils');

const isWindows = process.platform === 'win32';

// 工作目录（worktree 切换后 CLAUDE_WORKING_DIRECTORY 指向新 worktree）
const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 前置门禁
if (!commandExists('codegraph')) {
  process.exit(0);
}

if (!isGitRepo(cwd)) {
  process.exit(0);
}

// 锁机制（与 cg_init 共享）
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `codegraph-build-${cwdKey}.lock`);
const LOCK_STALE_MS = 4 * 60 * 60 * 1000;

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
const dbExists = fs.existsSync(dbFile);

// 决策矩阵
if (dbExists) {
  // DB 存在 → 后台 sync（增量更新）
  // sync 不需要锁（与 init 不冲突）
  const logDir = path.join(cwd, '.codegraph', 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (_) {}

  const logFile = path.join(logDir, `sync-worktree-${Date.now()}.log`);

  const wrapperCode = `
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    let out;
    try {
      out = fs.openSync(${JSON.stringify(logFile)}, 'a');
      spawnSync('codegraph', ['sync', ${JSON.stringify(cwd)}], {
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
  } catch (_) {}
  process.exit(0);
}

// DB 不存在 → 需要初始化（与 cg_init 相同逻辑）
if (isBuildLockActive()) {
  process.exit(0);
}

if (!tryAcquireBuildLock()) {
  process.exit(0);
}

// 后台 build
const logDir = path.join(cwd, '.codegraph', 'logs');
try {
  fs.mkdirSync(logDir, { recursive: true });
} catch (_) {}

const logFile = path.join(logDir, `init-worktree-${Date.now()}.log`);

const wrapperCode = `
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  let out;
  try {
    out = fs.openSync(${JSON.stringify(logFile)}, 'a');
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
