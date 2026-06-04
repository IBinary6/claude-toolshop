#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - Graphify 知识图谱智能初始化
// ABOUTME: 图谱完整 -> 跳过; 图谱缺失/空 -> 后台首次 build + 装 post-commit (有锁)
//
// 与 graphify 自带的 post-commit hook 配合:
//   - 本钩子负责"首次构建" (项目刚 clone 下来时)
//   - graphify 自己的 post-commit hook 负责"提交后增量"
//
// 不放 PostToolUse: graphify 每次 build 都要调 LLM 抽语义, 成本高,
// 不适合每次 Edit 都跑. 由 post-commit hook 在 commit 时增量即可.
//
// 锁路径按 cwd SHA1 哈希命名, 多仓库互不干扰.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isGitRepo, commandExists } = require('../lib/utils');

const TAG = '[graphify_build]';
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4h, graphify 大项目 LLM 抽取可能耗时
const MIN_VALID_GRAPH_BYTES = 10 * 1024;  // graph.json < 10KB 视为残缺/空

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const outDir = path.join(cwd, 'graphify-out');
const graphFile = path.join(outDir, 'graph.json');
const logFile = path.join(os.tmpdir(), 'graphify-build.log');
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `graphify-build-${cwdKey}.lock`);
const postCommitMarker = path.join(cwd, '.git', 'hooks', 'post-commit');

function logLine(msg) {
  try {
    fs.appendFileSync(logFile, `${TAG} ${new Date().toISOString()} ${msg}\n`);
  } catch (e) {}
}

logLine(`cwd=${cwd} CLAUDE_WORKING_DIRECTORY=${process.env.CLAUDE_WORKING_DIRECTORY || '(unset)'}`);

// 1) 静默退出条件: 非 git 仓库 / graphify 未安装
if (!isGitRepo(cwd)) { process.exit(0); }
if (!commandExists('graphify')) {
  logLine('graphify 不在 PATH, 跳过 (pip install "graphifyy[all]")');
  process.exit(0);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function isBuildLockActive() {
  let pid = 0;
  try {
    pid = parseInt(fs.readFileSync(buildLockFile, 'utf-8').trim(), 10) || 0;
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

// 2) 判断现有图谱是否有效
function isGraphValid() {
  try {
    const st = fs.statSync(graphFile);
    if (st.size >= MIN_VALID_GRAPH_BYTES) {
      logLine(`graph.json 已存在 size=${st.size}, 跳过`);
      return true;
    }
    // 太小, 视为残缺, 删除后重建
    try { fs.unlinkSync(graphFile); } catch (e) {}
    logLine(`graph.json 残缺 size=${st.size}, 已删准备重建`);
    return false;
  } catch (e) {
    // 不存在
    return false;
  }
}

// 3) 一次性装 graphify 自己的 post-commit hook (幂等)
function ensurePostCommitHook() {
  if (!fs.existsSync(path.join(cwd, '.git'))) return;
  try {
    // 已装则跳过 (graphify hook install 本身也是幂等的, 但避免无谓 spawn)
    if (fs.existsSync(postCommitMarker)) {
      const content = fs.readFileSync(postCommitMarker, 'utf-8');
      if (content.includes('graphify')) {
        logLine('post-commit hook 已包含 graphify, 跳过');
        return;
      }
    }
    const r = spawnSync('graphify', ['hook', 'install'], { cwd, encoding: 'utf-8' });
    logLine(`graphify hook install: rc=${r.status} ${(r.stdout || '').trim().slice(0, 100)}`);
  } catch (e) {
    logLine(`hook install 失败: ${e.message}`);
  }
}

// 4) 图谱有效就只检查 post-commit 后退出, 不再 LLM 重建
if (isGraphValid()) {
  ensurePostCommitHook();
  process.exit(0);
}

// 5) 已有 build 在跑 -> 跳过
if (isBuildLockActive()) {
  logLine('build 已在跑, 跳过');
  process.exit(0);
}

// 6) 原子获取锁, 失败说明被另一会话抢了
if (!tryAcquireBuildLock()) {
  logLine('lock 被抢, 跳过');
  process.exit(0);
}

// 7) 顺手装 post-commit hook (在首次 build 完成前就装好, 用户 commit 时就生效)
ensurePostCommitHook();

// 8) 后台 detached 跑 graphify, 不阻塞会话启动
//    wrapper 子进程负责等 graphify 退出后删 lock
const wrapperCode = `
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  let out;
  try {
    out = fs.openSync(${JSON.stringify(logFile)}, 'a');
    spawnSync('graphify', ['.'], {
      cwd: ${JSON.stringify(cwd)},
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
  const proc = spawn(process.execPath, ['-e', wrapperCode], {
    cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
  });
  proc.unref();
} catch (e) {
  try { fs.unlinkSync(buildLockFile); } catch (_) {}
}

logLine(`首次 build 已在后台启动 (lock pid=${process.pid}, LLM 抽取大项目可能耗时数分钟)`);
process.exit(0);
