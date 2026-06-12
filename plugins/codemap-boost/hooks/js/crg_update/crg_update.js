#!/usr/bin/env node
// ABOUTME: PostToolUse 钩子 - code-review-graph 智能增量更新
// ABOUTME: 图谱完整 -> 去抖 update; 图谱缺失/空 -> 后台 build (原子锁)
//
// 决策矩阵:
//   - 图谱完整 + 无 build       -> 去抖 update --repo cwd
//   - 图谱不存在 + 无 build     -> 启动后台 build, 原子写 lock
//   - 图谱空 (files==0)         -> 删 db, 走 build 分支
//   - lock PID 存活             -> 跳过 (避免重复 build)
//   - lock PID 已死 / mtime>4h  -> 清锁重启
//   - 非 git 仓库               -> 静默退出 (update 依赖 git diff)
//   - CRG CLI 不在 PATH         -> 静默退出
//
// 与 crg_build (SessionStart) 共用 build lock, 锁路径按 cwd SHA1 哈希命名.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isGitRepo, commandExists } = require('../lib/utils');

const TAG = '[crg_update]';
const DEBOUNCE_MS = 300;
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4h, 留足大仓库 build 余量
const MIN_VALID_FILES = 1; // 0=真空, ≥1 视为有效

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const graphDir = path.join(cwd, '.code-review-graph');
const dbFile = path.join(graphDir, 'graph.db');
const logFile = path.join(os.tmpdir(), 'crg-update.log');
const buildLogFile = path.join(os.tmpdir(), 'crg-build.log');
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const sentinelFile = path.join(os.tmpdir(), `crg-update-debounce-${cwdKey}.lock`);
const buildLockFile = path.join(os.tmpdir(), `crg-build-${cwdKey}.lock`);
const updateLockFile = path.join(os.tmpdir(), `crg-update-run-${cwdKey}.lock`);
const UPDATE_STALE_MS = 5 * 60 * 1000; // 5min, incremental update 不会超过这个时间

function logLine(msg) {
  try {
    fs.appendFileSync(logFile, `${TAG} ${new Date().toISOString()} ${msg}\n`);
  } catch (e) {}
}

logLine(`cwd=${cwd} CLAUDE_WORKING_DIRECTORY=${process.env.CLAUDE_WORKING_DIRECTORY || '(unset)'}`);

// CRG CLI 不在 PATH -> 静默退出, 避免后续死循环
if (!commandExists('code-review-graph')) {
  logLine('code-review-graph 不在 PATH, 跳过');
  process.exit(0);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function isBuildLockActive() {
  let pid = 0;
  try {
    const content = fs.readFileSync(buildLockFile, 'utf-8').trim();
    pid = parseInt(content, 10) || 0;
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
    // 'wx' = 原子创建, 已存在则失败 (防 TOCTOU)
    fs.writeFileSync(buildLockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) { return false; }
}

function isResidualGraph() {
  const result = spawnSync('code-review-graph', ['status', '--repo', cwd], { cwd, encoding: 'utf-8' });
  const m = (result.stdout || '').match(/Files:\s*(\d+)/);
  const fileCount = m ? parseInt(m[1], 10) : -1;
  // status 失败 (fileCount=-1) 不删 db, 避免命令异常误删
  if (fileCount === 0) {
    try { fs.unlinkSync(dbFile); } catch (e) {}
    logLine(`图谱空 (files=0), 已删 db 准备重建`);
    return true;
  }
  return false;
}

function startBackgroundBuild() {
  if (!tryAcquireBuildLock()) {
    logLine('build lock 被抢, 跳过');
    return;
  }
  const wrapperCode = `
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    try { fs.writeFileSync(${JSON.stringify(buildLockFile)}, String(process.pid)); } catch(e) {}
    let out;
    try {
      out = fs.openSync(${JSON.stringify(buildLogFile)}, 'a');
      spawnSync('code-review-graph', ['build', '--repo', ${JSON.stringify(cwd)}], {
        stdio: ['ignore', out, out], windowsHide: true,
      });
    } catch (e) {
    } finally {
      if (typeof out === 'number') {
        try { fs.closeSync(out); } catch (e) {}
      }
      try { fs.unlinkSync(${JSON.stringify(buildLockFile)}); } catch (e) {}
    }
  `;
  try {
    const wrapper = spawn(process.execPath, ['-e', wrapperCode], {
      cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
    });
    wrapper.unref();
    logLine(`图谱缺失, 后台 build 已启动 (lock pid=${process.pid})`);
  } catch (e) {
    try { fs.unlinkSync(buildLockFile); } catch (_) {}
  }
}

function runUpdate() {
  // 防止多 session 并发 update 同一 repo
  try {
    const st = fs.statSync(updateLockFile);
    if (Date.now() - st.mtimeMs < UPDATE_STALE_MS) {
      logLine('update 已在运行, 跳过');
      return;
    }
    fs.unlinkSync(updateLockFile);
  } catch (e) {}
  let out;
  try {
    fs.writeFileSync(updateLockFile, '1'); // mtime 即时间戳
    out = fs.openSync(logFile, 'a');
    const proc = spawn('code-review-graph', ['update', '--repo', cwd], {
      cwd, detached: true, windowsHide: true, stdio: ['ignore', out, out],
    });
    proc.unref();
  } catch (e) {
    try { fs.unlinkSync(updateLockFile); } catch (_) {}
    if (typeof out === 'number') {
      try { fs.closeSync(out); } catch (_) {}
    }
  }
}

// --- watcher 子模式: sleep + 比对 sentinel + 跑 update ---
const watcherFlagIdx = process.argv.indexOf('--watcher');
if (watcherFlagIdx > 0) {
  const myStamp = process.argv[watcherFlagIdx + 1];
  setTimeout(() => {
    let curStamp = '';
    try { curStamp = fs.readFileSync(sentinelFile, 'utf-8'); } catch (e) {}
    if (curStamp !== myStamp) return process.exit(0);
    if (!isGitRepo(cwd)) return process.exit(0);
    runUpdate();
    process.exit(0);
  }, DEBOUNCE_MS);
  return;
}

// --- 主模式 ---

// 图谱缺失或空 -> 走 build 分支
if (!fs.existsSync(graphDir) || isResidualGraph()) {
  if (isBuildLockActive()) {
    logLine('图谱构建中, 跳过本次触发');
    process.exit(0);
  }
  startBackgroundBuild();
  process.exit(0);
}

// 图谱完整但 build 在跑 (防御)
if (isBuildLockActive()) {
  logLine('build 仍在运行, 跳过 update');
  process.exit(0);
}

// 非 git 仓库 -> update 跑不动
if (!isGitRepo(cwd)) {
  process.exit(0);
}

// 去抖 update: 写 sentinel + 启 watcher
const myStamp = `${Date.now()}-${process.pid}`;
try {
  fs.writeFileSync(sentinelFile, myStamp);
} catch (e) {
  runUpdate();
  process.exit(0);
}

const watcher = spawn(process.execPath, [__filename, '--watcher', myStamp], {
  cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
});
watcher.unref();

logLine(`update 已计划 (debounce ${DEBOUNCE_MS}ms, stamp=${myStamp})`);
process.exit(0);
