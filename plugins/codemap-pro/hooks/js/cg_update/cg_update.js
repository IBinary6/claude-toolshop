#!/usr/bin/env node
/**
 * codemap-pro PostToolUse 钩子 - codegraph 智能增量更新
 *
 * 决策矩阵:
 *   - 图谱完整 + 无 build       → 去抖 sync
 *   - 图谱不存在 + 无 build     → 启动后台 init, 原子写 lock
 *   - lock PID 存活             → 跳过 (避免重复 build)
 *   - lock PID 已死 / mtime>4h  → 清锁重启
 *   - 非 git 仓库               → 静默退出
 *   - codegraph CLI 不在 PATH   → 静默退出
 *
 * 与 cg_init (SessionStart) 共用 build lock, 锁路径按 cwd SHA1 哈希命名.
 * 参考: codemap-boost/hooks/js/crg_update/crg_update.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { isGitRepo, commandExists } = require('../lib/utils');

const TAG = '[cg_update]';
const DEBOUNCE_MS = 300;
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4h
const isWindows = process.platform === 'win32';

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const graphDir = path.join(cwd, '.codegraph');
const dbFile = path.join(graphDir, 'codegraph.db');
const logFile = path.join(os.tmpdir(), 'codegraph-update.log');
const buildLogFile = path.join(os.tmpdir(), 'codegraph-build.log');
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const sentinelFile = path.join(os.tmpdir(), `codegraph-update-debounce-${cwdKey}.lock`);
const buildLockFile = path.join(os.tmpdir(), `codegraph-build-${cwdKey}.lock`);

function logLine(msg) {
  try {
    fs.appendFileSync(logFile, `${TAG} ${new Date().toISOString()} ${msg}\n`);
  } catch (e) {}
}

// codegraph CLI 不在 PATH → 静默退出
if (!commandExists('codegraph')) {
  process.exit(0);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function isBuildLockActive() {
  try {
    const content = fs.readFileSync(buildLockFile, 'utf-8').trim();
    const pid = parseInt(content, 10) || 0;
    const st = fs.statSync(buildLockFile);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS || !isPidAlive(pid)) {
      try { fs.unlinkSync(buildLockFile); } catch (e) {}
      return false;
    }
    return true;
  } catch (e) { return false; }
}

function tryAcquireBuildLock() {
  try {
    fs.writeFileSync(buildLockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) { return false; }
}

function startBackgroundInit() {
  if (!isGitRepo(cwd)) { return; }
  if (!tryAcquireBuildLock()) {
    logLine('build lock 被抢, 跳过');
    return;
  }

  const logDir = path.join(cwd, '.codegraph', 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}

  const wrapperCode = `
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    const out = fs.openSync(${JSON.stringify(buildLogFile)}, 'a');
    try {
      spawnSync('codegraph', ['init', '-i', ${JSON.stringify(cwd)}], {
        stdio: ['ignore', out, out], windowsHide: ${isWindows},
      });
    } finally {
      try { fs.closeSync(out); } catch (e) {}
      try { fs.unlinkSync(${JSON.stringify(buildLockFile)}); } catch (e) {}
    }
  `;
  const wrapper = spawn(process.execPath, ['-e', wrapperCode], {
    cwd, detached: true, windowsHide: isWindows, stdio: 'ignore', env: process.env,
  });
  wrapper.unref();
  logLine(`图谱缺失, 后台 init 已启动 (lock pid=${process.pid})`);
}

function runSync() {
  const out = fs.openSync(logFile, 'a');
  const proc = spawn('codegraph', ['sync', cwd], {
    cwd, detached: true, windowsHide: isWindows, stdio: ['ignore', out, out],
  });
  proc.unref();
}

// --- watcher 子模式: sleep + 比对 sentinel + 跑 sync ---
const watcherFlagIdx = process.argv.indexOf('--watcher');
if (watcherFlagIdx > 0) {
  const myStamp = process.argv[watcherFlagIdx + 1];
  setTimeout(() => {
    let curStamp = '';
    try { curStamp = fs.readFileSync(sentinelFile, 'utf-8'); } catch (e) {}
    if (curStamp !== myStamp) return process.exit(0);
    if (!isGitRepo(cwd)) return process.exit(0);
    runSync();
    process.exit(0);
  }, DEBOUNCE_MS);
  return;
}

// --- 主模式 ---

// 图谱缺失 → 走 init 分支
if (!fs.existsSync(dbFile)) {
  if (isBuildLockActive()) {
    logLine('图谱构建中, 跳过本次触发');
    process.exit(0);
  }
  startBackgroundInit();
  process.exit(0);
}

// 图谱完整但 build 在跑 (防御)
if (isBuildLockActive()) {
  logLine('build 仍在运行, 跳过 sync');
  process.exit(0);
}

// 非 git 仓库 → sync 跑不动
if (!isGitRepo(cwd)) {
  process.exit(0);
}

// 去抖 sync: 写 sentinel + 启 watcher
const myStamp = `${Date.now()}-${process.pid}`;
try {
  fs.writeFileSync(sentinelFile, myStamp);
} catch (e) {
  runSync();
  process.exit(0);
}

const watcher = spawn(process.execPath, [__filename, '--watcher', myStamp], {
  cwd, detached: true, windowsHide: isWindows, stdio: 'ignore', env: process.env,
});
watcher.unref();

logLine(`sync 已计划 (debounce ${DEBOUNCE_MS}ms, stamp=${myStamp})`);
process.exit(0);
