'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;

const preCommit = hooks.PreToolUse.find((entry) =>
  entry.hooks.some((hook) => hook.command.includes('pre_commit.js')));
assert.ok(preCommit, '必须注册 pre_commit.js');
assert.ok(preCommit.matcher.includes('Bash'), 'pre-commit 必须覆盖 Bash');
assert.ok(preCommit.matcher.includes('PowerShell'), 'pre-commit 必须覆盖 PowerShell');

const postEdit = hooks.PostToolUse.find((entry) =>
  entry.hooks.some((hook) => hook.command.includes('post_edit.js')));
assert.ok(postEdit, '必须注册 post_edit.js');
for (const tool of ['MultiEdit', 'NotebookEdit', 'patch', 'apply', 'update']) {
  assert.ok(postEdit.matcher.includes(tool), `PostToolUse matcher 必须覆盖 ${tool}`);
}

console.log('hooks_contract.test.js PASS');
