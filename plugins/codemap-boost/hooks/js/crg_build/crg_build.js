#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - code-review-graph 智能初始化
// ABOUTME: 图谱完整 -> 打印 status; 图谱空/缺失 -> 后台 build (原子锁)
//
// 与 crg_update 共用 build lock, 锁路径按 cwd SHA1 哈希命名.
// 残缺判定: status 返回 Files == 0 (真空). status 失败时不删 db.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isGitRepo, commandExists } = require('../lib/utils');

const TAG = '[crg_build]';
const LOCK_STALE_MS = 4 * 60 * 60 * 1000; // 4h
const MIN_VALID_FILES = 1;

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const graphDir = path.join(cwd, '.code-review-graph');
const dbFile = path.join(graphDir, 'graph.db');
const logFile = path.join(os.tmpdir(), 'crg-build.log');
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const buildLockFile = path.join(os.tmpdir(), `crg-build-${cwdKey}.lock`);

function logLine(msg) {
  try {
    fs.appendFileSync(logFile, `${TAG} ${new Date().toISOString()} ${msg}\n`);
  } catch (e) {}
}

logLine(`cwd=${cwd} CLAUDE_WORKING_DIRECTORY=${process.env.CLAUDE_WORKING_DIRECTORY || '(unset)'}`);

// CRG CLI 不在 PATH -> 提示用户安装，然后退出
if (!commandExists('code-review-graph')) {
  logLine('code-review-graph 不在 PATH, 跳过');
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: '⚠️ [codemap-boost] code-review-graph CLI 未安装，图谱自动更新不可用。请运行 /codemap-boost-setup 完成安装。'
      }
    }) + '\n');
  } catch (e) {}
  process.exit(0);
}

// 非 git 仓库 -> update 跑不了, build 也没意义
if (!isGitRepo(cwd)) {
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
    fs.writeFileSync(buildLockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) { return false; }
}

function isGraphValid() {
  const result = spawnSync('code-review-graph', ['status', '--repo', cwd], { cwd, encoding: 'utf-8' });
  const m = (result.stdout || '').match(/Files:\s*(\d+)/);
  const fileCount = m ? parseInt(m[1], 10) : -1;
  if (fileCount >= MIN_VALID_FILES) {
    logLine(`status: files=${fileCount}`);
    return true;
  }
  // status 失败 (fileCount=-1) 视为有效, 避免 CLI 异常时误删
  if (fileCount < 0) {
    logLine('status 失败, 保留现有 db');
    return true;
  }
  try { fs.unlinkSync(dbFile); } catch (e) {}
  logLine(`图谱空 (files=${fileCount}), 已删 db 准备重建`);
  return false;
}

// 图谱目录存在且有效 -> 不动
if (fs.existsSync(graphDir) && isGraphValid()) {
  process.stdout.write('🗺️ [CRG] 图谱就绪，自动增量更新已激活\n');
  process.exit(0);
}

// 缺失或空: 已有 build 在跑则跳过
if (isBuildLockActive()) {
  logLine('build 已由其他流程触发, 跳过');
  process.exit(0);
}

// 原子获取 build lock
if (!tryAcquireBuildLock()) {
  logLine('build lock 被抢, 跳过');
  process.exit(0);
}

const wrapperCode = `
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  let out;
  try {
    out = fs.openSync(${JSON.stringify(logFile)}, 'a');
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
  const proc = spawn(process.execPath, ['-e', wrapperCode], {
    cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
  });
  proc.unref();
} catch (e) {
  try { fs.unlinkSync(buildLockFile); } catch (_) {}
}

logLine(`首次 build 已在后台启动 (lock pid=${process.pid})`);
process.exit(0);
