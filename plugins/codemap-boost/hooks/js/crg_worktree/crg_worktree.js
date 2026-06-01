#!/usr/bin/env node
// ABOUTME: PostToolUse:EnterWorktree 钩子 - 进入 worktree 时智能重建/更新图谱
// ABOUTME: 图谱不存在 -> 后台 build; 图谱有效 -> 增量 update; 图谱空 -> 删 db 重建
//
// 决策矩阵:
//   - graph.db 不存在           -> 获取 lock, 后台 build --repo cwd
//   - graph.db 存在 + Files > 0 -> 后台 update --repo cwd (增量更新)
//   - graph.db 存在 + Files == 0-> 删 db, 获取 lock, 后台 build
//   - status 命令失败           -> 保留现有 db, 不动
//   - build lock 存活           -> 跳过 (避免重复 build)
//   - 非 git 仓库              -> 静默退出
//   - CRG CLI 不在 PATH        -> 静默退出
//
// 与 crg_build / crg_update 共用 build lock, 锁路径按 cwd SHA1 哈希命名.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isGitRepo, commandExists } = require('../lib/utils');

const TAG = '[crg_worktree]';
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4h
const MIN_VALID_FILES = 1;

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const graphDir = path.join(cwd, '.code-review-graph');
const dbFile = path.join(graphDir, 'graph.db');
const logFile = path.join(os.tmpdir(), 'crg-worktree.log');
const buildLogFile = path.join(os.tmpdir(), 'crg-build.log');
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `crg-build-${cwdKey}.lock`);

function logLine(msg) {
  try {
    fs.appendFileSync(logFile, `${TAG} ${new Date().toISOString()} ${msg}\n`);
  } catch (e) {}
}

logLine(`cwd=${cwd} CLAUDE_WORKING_DIRECTORY=${process.env.CLAUDE_WORKING_DIRECTORY || '(unset)'}`);

// CRG CLI 不在 PATH -> 静默退出
if (!commandExists('code-review-graph')) {
  logLine('code-review-graph 不在 PATH, 跳过');
  process.exit(0);
}

// 非 git 仓库 -> 无法构建图谱
if (!isGitRepo(cwd)) {
  logLine('非 git 仓库, 跳过');
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

/**
 * 查询图谱状态：返回文件数。
 * 失败返回 -1（不删 db，避免 CLI 异常误删）。
 */
function getGraphFileCount() {
  const result = spawnSync('code-review-graph', ['status', '--repo', cwd], {
    cwd, encoding: 'utf-8', windowsHide: true,
  });
  const m = (result.stdout || '').match(/Files:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

/**
 * 后台启动全量 build（detached + unref）
 */
function startBackgroundBuild() {
  if (!tryAcquireBuildLock()) {
    logLine('build lock 被抢, 跳过');
    return;
  }
  const wrapperCode = `
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    const out = fs.openSync(${JSON.stringify(buildLogFile)}, 'a');
    try {
      spawnSync('code-review-graph', ['build', '--repo', ${JSON.stringify(cwd)}], {
        stdio: ['ignore', out, out], windowsHide: true,
      });
    } finally {
      try { fs.unlinkSync(${JSON.stringify(buildLockFile)}); } catch (e) {}
    }
  `;
  const proc = spawn(process.execPath, ['-e', wrapperCode], {
    cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
  });
  proc.unref();
  logLine(`后台 build 已启动 (lock pid=${process.pid})`);
}

/**
 * 后台启动增量 update（detached + unref）
 */
function startBackgroundUpdate() {
  const out = fs.openSync(logFile, 'a');
  const proc = spawn('code-review-graph', ['update', '--repo', cwd], {
    cwd, detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  proc.unref();
  logLine('后台 update 已启动');
}

// --- 主逻辑 ---

// build lock 存活 -> 有构建在跑, 跳过
if (isBuildLockActive()) {
  logLine('build lock 存活, 跳过');
  process.exit(0);
}

// 图谱目录/文件不存在 -> 全量 build
if (!fs.existsSync(graphDir) || !fs.existsSync(dbFile)) {
  logLine('图谱不存在, 准备 build');
  startBackgroundBuild();
  process.exit(0);
}

// 图谱存在 -> 查状态决定 update 还是 rebuild
const fileCount = getGraphFileCount();

if (fileCount < 0) {
  // status 命令失败 -> 保守处理, 不动
  logLine('status 命令失败, 保留现有 db');
  process.exit(0);
}

if (fileCount >= MIN_VALID_FILES) {
  // 图谱有效 -> 增量 update
  startBackgroundUpdate();
  process.exit(0);
}

// Files == 0: 图谱空 -> 删 db 重建
try { fs.unlinkSync(dbFile); } catch (e) {}
logLine(`图谱空 (files=${fileCount}), 已删 db 准备重建`);
startBackgroundBuild();
process.exit(0);
