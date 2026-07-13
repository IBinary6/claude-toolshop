'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function untrackedSourceFiles(cwd) {
  const result = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || '')
    .split('\0')
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
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
  if (process.platform !== 'win32') return spawnSync('code-review-graph', args, options);
  const command = ['code-review-graph', ...args].map(quoteCmd).join(' ');
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

module.exports = {
  runCrgRefresh,
  untrackedSourceFiles,
  withTemporaryGitIndex,
};
