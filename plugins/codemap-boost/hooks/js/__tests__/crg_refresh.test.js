'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runCrgRefresh } = require('../lib/crg_refresh');

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

  console.log('crg_refresh.test.js PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
