'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;

const preCommit = hooks.PreToolUse.find((entry) =>
  entry.hooks.some((hook) => hook.command.includes('pre_commit.js')));
assert.ok(preCommit, 'pre_commit.js must be registered');
assert.ok(preCommit.matcher.includes('Bash'), 'pre-commit must cover Bash');
assert.ok(preCommit.matcher.includes('PowerShell'), 'pre-commit must cover PowerShell');

const postEdit = hooks.PostToolUse.find((entry) =>
  entry.hooks.some((hook) => hook.command.includes('post_edit.js')));
assert.ok(postEdit, 'post_edit.js must be registered');
for (const tool of ['MultiEdit', 'NotebookEdit', 'patch', 'apply', 'update']) {
  assert.ok(postEdit.matcher.includes(tool), `the PostToolUse matcher must cover ${tool}`);
}

// Edits are only recorded; the finalizer must be attached to both the main agent's Stop and the subagent's SubagentStop,
// otherwise C++ files a subagent changed would sit in the pending queue forever without being checked.
for (const event of ['Stop', 'SubagentStop']) {
  const finalizer = (hooks[event] || []).flatMap((entry) => entry.hooks)
    .find((hook) => hook.command.includes('stop_check.js'));
  assert.ok(finalizer, `${event} must register stop_check.js`);
  assert.ok(finalizer.timeout >= 50, `${event} timeout must exceed stop_check's internal 45s deadline, leaving room to requeue files`);
}

console.log('hooks_contract.test.js PASS');
