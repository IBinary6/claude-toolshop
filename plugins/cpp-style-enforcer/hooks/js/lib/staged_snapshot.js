'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const MAX_BLOB_SIZE = 32 * 1024 * 1024;

/**
 * Convert a working-tree path to a safe repository-relative path for Git index queries.
 * @param {string} root
 * @param {string} filePath
 * @returns {string}
 */
function relativeGitPath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`The file is not inside the repository root: ${filePath}`);
  }
  return relative.split(path.sep).join('/');
}

/**
 * Read the blob at the given path from the Git index; null means the path is not in the index right now.
 * @param {string} root
 * @param {string} relativePath
 * @returns {Buffer|null}
 */
function readIndexBlob(root, relativePath) {
  const result = spawnSync('git', ['cat-file', 'blob', `:${relativePath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: MAX_BLOB_SIZE,
    timeout: 5000,
    windowsHide: isWindows,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  return result.stdout;
}

/**
 * List every path currently in the index, used to find the applicable CPPLINT.cfg files.
 * @param {string} root
 * @returns {string[]}
 */
function listIndexPaths(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: root,
    encoding: null,
    timeout: 5000,
    windowsHide: isWindows,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error('Could not read the Git index file list');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

/**
 * Write an index blob into the snapshot, keeping the repository-relative path and the original bytes.
 * @param {string} snapshotRoot
 * @param {string} relativePath
 * @param {Buffer} contents
 * @returns {string}
 */
function writeSnapshotFile(snapshotRoot, relativePath, contents) {
  const target = path.resolve(snapshotRoot, ...relativePath.split('/'));
  const rootWithSeparator = `${path.resolve(snapshotRoot)}${path.sep}`;
  if (!target.startsWith(rootWithSeparator)) {
    throw new Error(`Illegal repository-relative path: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

/**
 * Create a temporary snapshot of the Git index (read-only in spirit).
 * The snapshot holds the C++ files to check plus every CPPLINT.cfg in the index, so cpplint keeps
 * its header guard, include_order and directory-level configuration semantics. Callers must clean it up in finally.
 * @param {string} root
 * @param {string[]} filePaths Absolute working-tree paths of the files to check.
 * @returns {{root:string, files:Array<{relativePath:string,filePath:string}>, cleanup:Function}}
 * @example
 * const snap = createStagedSnapshot(root, [path.join(root, 'src/a.cpp')]);
 * try { lint(snap.files[0].filePath); } finally { snap.cleanup(); }
 */
function createStagedSnapshot(root, filePaths) {
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-style-staged-'));
  try {
    const relativeFiles = filePaths.map((filePath) => relativeGitPath(root, filePath));
    const configFiles = listIndexPaths(root).filter((relativePath) => (
      path.posix.basename(relativePath) === 'CPPLINT.cfg'
    ));
    const pathsToCopy = [...new Set([...relativeFiles, ...configFiles])];

    for (const relativePath of pathsToCopy) {
      const blob = readIndexBlob(root, relativePath);
      if (!blob) throw new Error(`Could not read the Git index blob: ${relativePath}`);
      writeSnapshotFile(snapshotRoot, relativePath, blob);
    }

    const files = relativeFiles.map((relativePath) => ({
      relativePath,
      filePath: path.resolve(snapshotRoot, ...relativePath.split('/')),
    }));
    return {
      root: snapshotRoot,
      files,
      cleanup: () => fs.rmSync(snapshotRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  relativeGitPath,
  readIndexBlob,
  listIndexPaths,
  createStagedSnapshot,
};
