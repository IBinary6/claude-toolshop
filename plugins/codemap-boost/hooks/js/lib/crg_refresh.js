'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LOCK_BOOT_MS = 5000;
const LOCK_STALE_MS = 4 * 60 * 60 * 1000;
const REFRESH_WAIT_MS = 10 * 60 * 1000;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.cs', '.go', '.java', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.kt', '.kts', '.php', '.py', '.rb', '.rs', '.scala', '.swift', '.vue', '.svelte',
]);

function git(cwd, args, options = {}) {
  return spawnSync('git', args, {
    cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.stdio || 'pipe',
    timeout: options.timeout || 120000,
  });
}

function repoRoot(cwd) {
  const result = git(cwd, ['rev-parse', '--show-toplevel']);
  if (result.error || result.status !== 0 || !result.stdout.trim()) return null;
  return path.resolve(result.stdout.trim());
}

function untrackedSourceFiles(cwd) {
  const result = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || '')
    .split('\0')
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

function lockName(prefix, cwd) {
  const key = crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return `${prefix}-${key}.lock`;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function isLockActive(file, staleMs = LOCK_STALE_MS) {
  try {
    const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10) || 0;
    const stat = fs.statSync(file);
    const age = Date.now() - stat.mtimeMs;
    if (age <= LOCK_BOOT_MS) return true;
    if (age <= staleMs && isPidAlive(pid)) return true;
    fs.unlinkSync(file);
  } catch (_) {}
  return false;
}

function tryWriteLock(file) {
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch (_) {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockPaths(cwd) {
  return {
    buildLockFile: path.join(os.tmpdir(), lockName('crg-build', cwd)),
    updateLockFile: path.join(os.tmpdir(), lockName('crg-update-run', cwd)),
  };
}

function acquireRefreshLock(cwd, mode, waitMs = REFRESH_WAIT_MS) {
  const { buildLockFile, updateLockFile } = lockPaths(cwd);
  const lockFile = mode === 'build' ? buildLockFile : updateLockFile;
  const otherLockFile = mode === 'build' ? updateLockFile : buildLockFile;
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const thisActive = isLockActive(lockFile);
    const otherActive = isLockActive(otherLockFile);
    if (!thisActive && !otherActive && tryWriteLock(lockFile)) return lockFile;
    sleepSync(100);
  }
  return null;
}

function withTemporaryGitIndex(cwd, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-git-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD']);
    const readTree = git(cwd, head.status === 0 ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], { env });
    if (readTree.error || readTree.status !== 0) return false;
    const add = git(cwd, ['add', '-A', '--', '.'], { env });
    if (add.error || add.status !== 0) return false;
    return callback(env);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function runCrgDefault(args, options) {
  const crg = require('./managed_runtime').crgCommand();
  // 插件私有 CRG 是确定的可执行文件绝对路径，直接 spawn：经 cmd /c 再包一层引号会被 Node 转义成
  // \"C:\...\" 而无法识别（路径含空格或反斜杠时必现）。只有 PATH 上的裸命令名可能是 .cmd shim，才走 cmd。
  if (process.platform !== 'win32' || path.isAbsolute(crg)) return spawnSync(crg, args, options);
  const command = [crg, ...args].map(quoteCmd).join(' ');
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options);
}

function runCrgRefresh(cwd, requestedMode, logFile, options = {}) {
  const hasUntrackedSource = untrackedSourceFiles(cwd).length > 0;
  const mode = hasUntrackedSource ? 'build' : requestedMode;
  const runCrg = options.runCrg || runCrgDefault;
  const invoke = (env) => {
    let out;
    try {
      out = logFile ? fs.openSync(logFile, 'a') : undefined;
      const result = runCrg([mode, '--repo', cwd], {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
        stdio: out === undefined ? 'pipe' : ['ignore', out, out],
        timeout: options.timeout || 10 * 60 * 1000,
      });
      return !result.error && result.status === 0;
    } finally {
      if (typeof out === 'number') {
        try { fs.closeSync(out); } catch (_) {}
      }
    }
  };
  const success = hasUntrackedSource
    ? withTemporaryGitIndex(cwd, invoke)
    : invoke(process.env);
  return { success, mode, usedTemporaryIndex: hasUntrackedSource };
}

function refreshCrgSync(cwd, options = {}) {
  const root = repoRoot(cwd);
  if (!root) return false;
  const hasUntrackedSource = untrackedSourceFiles(root).length > 0;
  const hasGraph = fs.existsSync(path.join(root, '.code-review-graph'));
  const mode = hasUntrackedSource || !hasGraph ? 'build' : 'update';
  const lockFile = acquireRefreshLock(root, mode, options.waitMs || REFRESH_WAIT_MS);
  if (!lockFile) return false;
  try {
    return runCrgRefresh(root, mode, options.logFile || null, options).success;
  } finally {
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

module.exports = {
  acquireRefreshLock,
  refreshCrgSync,
  lockPaths,
  runCrgRefresh,
  untrackedSourceFiles,
  withTemporaryGitIndex,
  repoRoot,
};
