#!/usr/bin/env node
// ABOUTME: SessionEnd 钩子 - 清理 CRG/graphify 过期 lock 文件
// ABOUTME: 不主动杀后台构建，避免结束钩子误伤仍在运行的 build

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const cwdKey = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
const BUILD_LOCK_STALE_MS = 4 * 60 * 60 * 1000;
const UPDATE_LOCK_STALE_MS = 5 * 60 * 1000;

const buildLocks = [
  path.join(os.tmpdir(), `crg-build-${cwdKey}.lock`),
  path.join(os.tmpdir(), `graphify-build-${cwdKey}.lock`),
];
const otherLocks = [
  path.join(os.tmpdir(), `crg-update-run-${cwdKey}.lock`),
  path.join(os.tmpdir(), `crg-update-debounce-${cwdKey}.lock`),
];

function removeIfStale(lockFile, staleMs) {
  try {
    const stat = fs.statSync(lockFile);
    if (Date.now() - stat.mtimeMs > staleMs) {
      try { fs.unlinkSync(lockFile); } catch (e) {}
    }
  } catch (e) {}
}

for (const lockFile of buildLocks) {
  removeIfStale(lockFile, BUILD_LOCK_STALE_MS);
}

for (const lockFile of otherLocks) {
  removeIfStale(lockFile, UPDATE_LOCK_STALE_MS);
}

process.exit(0);
