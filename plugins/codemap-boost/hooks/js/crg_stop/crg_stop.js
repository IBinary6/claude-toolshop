#!/usr/bin/env node
// ABOUTME: Stop 钩子 - Claude 会话结束时清理 CRG/graphify 残留进程和 lock 文件
// ABOUTME: 正常关闭 + 崩溃重启都能保证下次会话不受残留 lock 干扰

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);

// build lock 内有包装进程 PID，用 taskkill /T 杀进程树（包含 code-review-graph.exe）
const buildLocks = [
  path.join(os.tmpdir(), `crg-build-${cwdKey}.lock`),
  path.join(os.tmpdir(), `graphify-build-${cwdKey}.lock`),
];
// update lock 只靠 mtime，直接删即可
const otherLocks = [
  path.join(os.tmpdir(), `crg-update-run-${cwdKey}.lock`),
  path.join(os.tmpdir(), `crg-update-debounce-${cwdKey}.lock`),
];

for (const lockFile of buildLocks) {
  try {
    const pid = parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10);
    if (pid > 0) {
      if (process.platform === 'win32') {
        // /T 递归杀进程树，确保 code-review-graph.exe 子进程一并结束
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)],
          { stdio: 'ignore', windowsHide: true });
      } else {
        try { process.kill(-pid, 'SIGTERM'); } catch (e) {}
      }
    }
  } catch (e) {}
  try { fs.unlinkSync(lockFile); } catch (e) {}
}

for (const lockFile of otherLocks) {
  try { fs.unlinkSync(lockFile); } catch (e) {}
}

process.exit(0);
