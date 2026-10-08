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

// 编辑阶段只记录；规范化必须同时挂在主 Agent 的 Stop 与子代理的 SubagentStop，
// 否则子代理改过的 C++ 文件会一直滞留在待处理队列里不被检查。
for (const event of ['Stop', 'SubagentStop']) {
  const finalizer = (hooks[event] || []).flatMap((entry) => entry.hooks)
    .find((hook) => hook.command.includes('stop_check.js'));
  assert.ok(finalizer, `${event} 必须注册 stop_check.js`);
  assert.ok(finalizer.timeout >= 50, `${event} 超时须大于 stop_check 内部 45s 截止，留出放回队列的余量`);
}

console.log('hooks_contract.test.js PASS');
