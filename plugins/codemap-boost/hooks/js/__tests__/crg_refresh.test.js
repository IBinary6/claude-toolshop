'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { lockPaths, refreshCrgSync, runCrgRefresh } = require('../lib/crg_refresh');

function git(cwd, args, env = process.env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || '').trim();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-crg-refresh-'));
try {
  git(tmp, ['init']);
  git(tmp, ['config', 'user.email', 'test@example.com']);
  git(tmp, ['config', 'user.name', 'CodeMap Test']);
  fs.writeFileSync(path.join(tmp, 'tracked.js'), 'function tracked() {}\n');
  git(tmp, ['add', 'tracked.js']);
  git(tmp, ['commit', '-m', 'init']);

  const calls = [];
  const options = {
    runCrg: (args, runOptions) => {
      const index = runOptions.env && runOptions.env.GIT_INDEX_FILE;
      calls.push({
        args: [...args],
        index,
        files: index ? git(tmp, ['ls-files'], runOptions.env) : '',
      });
      return { status: 0 };
    },
  };

  let result = runCrgRefresh(tmp, 'update', null, options);
  assert.equal(result.success, true);
  assert.equal(result.mode, 'update', 'existing graph refresh uses update when no source is untracked');
  assert.equal(result.usedTemporaryIndex, false);

  fs.writeFileSync(path.join(tmp, 'new-source.cpp'), 'int Added() { return 1; }\n');
  assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '', 'real index starts clean');
  result = runCrgRefresh(tmp, 'update', null, options);
  assert.equal(result.success, true);
  assert.equal(result.mode, 'build', 'untracked source forces a full build');
  assert.equal(result.usedTemporaryIndex, true);
  assert.ok(calls[1].index, 'full build uses a temporary Git index');
  assert.ok(calls[1].files.split(/\r?\n/).includes('new-source.cpp'));
  assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '', 'real index remains untouched');

  git(tmp, ['add', 'new-source.cpp']);
  git(tmp, ['commit', '-m', 'add source']);
  fs.mkdirSync(path.join(tmp, '.code-review-graph'));

  const syncCalls = [];
  const syncOptions = {
    runCrg: (args, runOptions) => {
      const index = runOptions.env && runOptions.env.GIT_INDEX_FILE;
      syncCalls.push({
        args: [...args],
        index,
        files: index ? git(tmp, ['ls-files'], runOptions.env) : '',
      });
      return { status: 0 };
    },
  };

  assert.equal(refreshCrgSync(tmp, syncOptions), true);
  assert.equal(syncCalls[0].args[0], 'update', 'sync refresh updates when graph exists and no source is untracked');
  assert.equal(syncCalls[0].args[2], tmp, 'sync refresh targets the repository root');

  fs.writeFileSync(path.join(tmp, 'new-sync.ts'), 'export function added() { return 2; }\n');
  assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '', 'real index starts clean before sync build');
  assert.equal(refreshCrgSync(tmp, syncOptions), true);
  assert.equal(syncCalls[1].args[0], 'build', 'sync refresh builds when source is untracked');
  assert.ok(syncCalls[1].index, 'sync full build uses a temporary Git index');
  assert.ok(syncCalls[1].files.split(/\r?\n/).includes('new-sync.ts'));
  assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '', 'sync full build leaves real index untouched');

  const { buildLockFile } = lockPaths(tmp);
  fs.writeFileSync(buildLockFile, '0', 'utf8');
  try {
    const before = syncCalls.length;
    assert.equal(refreshCrgSync(tmp, { ...syncOptions, waitMs: 1 }), false, 'active refresh lock blocks graph reads');
    assert.equal(syncCalls.length, before, 'blocked refresh must not invoke code-review-graph');
  } finally {
    try { fs.unlinkSync(buildLockFile); } catch (_) {}
  }

  console.log('crg_refresh.test.js PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
