'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';

/**
 * Resolve the real path; Windows 8.3 short paths (such as RUNNER~1) and the long path Git returns are unified before comparing.
 * Falls back to path.resolve when the path does not exist.
 * @param {string} filePath
 * @returns {string}
 * @example
 * canonicalPath('C:\Users\RUNNER~1\a.cpp') // 'C:\Users\runneradmin\a.cpp'
 */
function canonicalPath(filePath) {
  try {
    const realpath = fs.realpathSync.native || fs.realpathSync;
    return realpath(filePath);
  } catch (_) {
    return path.resolve(filePath);
  }
}

function gitDir(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      ? filePath : path.dirname(filePath);
  } catch (_) {
    return path.dirname(filePath);
  }
}

/**
 * Walk up from the file to find the git repository root. Returns null outside a git repo.
 * @param {string} filePath
 * @returns {string|null}
 */
function repoRoot(filePath) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: gitDir(filePath), stdio: 'pipe', timeout: 3000, windowsHide: isWindows,
  });
  if (r.status !== 0) return null;
  return (r.stdout || Buffer.alloc(0)).toString('utf-8').trim() || null;
}

/**
 * New-file check: a file that is not in HEAD (the committed history) is new.
 * Covers untracked, staged-but-uncommitted and first-commit files. Not a git repo (root=null) -> true (treated as new).
 * A repository with no commits (invalid HEAD) -> cat-file fails -> every file counts as new.
 * @param {string} filePath
 * @param {string|null} root
 * @returns {boolean}
 */
function isNew(filePath, root) {
  if (!root) return true;
  // Unify real paths first, so a short path does not make path.relative produce ../../RUNNER~1/... and misjudge the file as new.
  const rel = path.relative(canonicalPath(root), canonicalPath(filePath))
    .split(path.sep).join('/');
  const r = spawnSync('git', ['cat-file', '-e', `HEAD:${rel}`], {
    cwd: root, stdio: 'pipe', timeout: 3000, windowsHide: isWindows,
  });
  return r.status !== 0;
}

/**
 * Changed-line ranges [[start,end],...] of the working tree plus index relative to HEAD.
 * Parsed from `git diff -U0 HEAD` hunk headers @@ +start,len @@; len=0 (pure deletion) is skipped.
 * Returns null when not a git repo (root=null) or diff fails; returns [] when nothing changed.
 * @param {string} filePath
 * @param {string|null} root
 * @returns {Array<[number,number]>|null}
 */
function changedLineRanges(filePath, root) {
  if (!root) return null;
  const r = spawnSync('git', ['diff', '-U0', 'HEAD', '--', filePath], {
    cwd: root, stdio: 'pipe', timeout: 5000, windowsHide: isWindows,
  });
  if (r.status !== 0) return null;
  const out = (r.stdout || Buffer.alloc(0)).toString('utf-8');
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  const ranges = [];
  let m;
  while ((m = re.exec(out)) !== null) {
    const start = parseInt(m[1], 10);
    const len = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    if (len === 0) continue; // Pure deletion: no corresponding line on the new-file side
    ranges.push([start, start + len - 1]);
  }
  return ranges;
}

module.exports = { repoRoot, isNew, changedLineRanges };
