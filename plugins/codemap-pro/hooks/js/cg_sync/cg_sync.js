#!/usr/bin/env node
/**
 * codemap-pro PostToolUse 兜底同步钩子。
 *
 * CodeGraph MCP Server 原生 watcher 是主路径；本钩子只在编辑、写入或 Bash
 * 后做低频兜底：已有数据库时后台 `codegraph sync`，缺数据库时后台
 * `codegraph init -i`。所有异常静默降级，避免阻塞用户操作。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { commandExists, isGitRepo } = require('../lib/utils');

const isWindows = process.platform === 'win32';
const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `codegraph-build-${cwdKey}.lock`);
const syncLockFile = path.join(os.tmpdir(), `codegraph-sync-${cwdKey}.lock`);
const SYNC_LOCK_STALE_MS = 10 * 60 * 1000;
const BUILD_LOCK_STALE_MS = 4 * 60 * 60 * 1000;

if (!commandExists('codegraph')) {
  process.exit(0);
}

if (!isGitRepo(cwd)) {
  process.exit(0);
}

/**
 * 检查进程是否仍然存活。
 *
 * @param {number} pid 待检测的进程号。
 * @returns {boolean} 进程存在时返回 true。
 */
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 判断锁是否仍有效，陈旧锁会被自动清理。
 *
 * @param {string} file 锁文件路径。
 * @param {number} staleMs 陈旧锁阈值。
 * @returns {boolean} 锁仍有效时返回 true。
 */
function isLockActive(file, staleMs) {
  try {
    const pid = parseInt(fs.readFileSync(file, 'utf-8').trim(), 10) || 0;
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > staleMs || !isPidAlive(pid)) {
      try {
        fs.unlinkSync(file);
      } catch (_) {}
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 原子获取锁，避免频繁编辑触发重复后台任务。
 *
 * @param {string} file 锁文件路径。
 * @returns {boolean} 获取成功时返回 true。
 */
function tryAcquireLock(file) {
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 后台执行 CodeGraph 命令，并在完成后释放对应锁。
 *
 * @param {string[]} args codegraph 参数列表。
 * @param {string} lockFile 需要释放的锁文件。
 * @param {string} logName 日志文件名前缀。
 */
function startBackground(args, lockFile, logName) {
  const logDir = path.join(cwd, '.codegraph', 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (_) {}

  const logFile = path.join(logDir, `${logName}-${Date.now()}.log`);
  const wrapperCode = `
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    let out;
    try {
      out = fs.openSync(${JSON.stringify(logFile)}, 'a');
      spawnSync('codegraph', ${JSON.stringify(args)}, {
        stdio: ['ignore', out, out],
        windowsHide: ${isWindows},
      });
    } catch (e) {
    } finally {
      if (typeof out === 'number') {
        try { fs.closeSync(out); } catch (e) {}
      }
      try { fs.unlinkSync(${JSON.stringify(lockFile)}); } catch (e) {}
    }
  `;

  try {
    const proc = spawn(process.execPath, ['-e', wrapperCode], {
      cwd,
      detached: true,
      windowsHide: isWindows,
      stdio: 'ignore',
      env: process.env,
    });
    try {
      fs.writeFileSync(lockFile, String(proc.pid));
    } catch (_) {}
    proc.unref();
  } catch (_) {
    try {
      fs.unlinkSync(lockFile);
    } catch (_) {}
  }
}

const dbFile = path.join(cwd, '.codegraph', 'codegraph.db');

if (fs.existsSync(dbFile)) {
  if (isLockActive(syncLockFile, SYNC_LOCK_STALE_MS) || !tryAcquireLock(syncLockFile)) {
    process.exit(0);
  }
  startBackground(['sync', cwd], syncLockFile, 'sync-posttool');
  process.exit(0);
}

if (isLockActive(buildLockFile, BUILD_LOCK_STALE_MS) || !tryAcquireLock(buildLockFile)) {
  process.exit(0);
}

startBackground(['init', '-i', cwd], buildLockFile, 'init-posttool');
process.exit(0);
