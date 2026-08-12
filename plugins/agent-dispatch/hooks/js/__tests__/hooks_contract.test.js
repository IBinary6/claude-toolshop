'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;

assert.equal(hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
assert.ok(hooks.SubagentStart, 'SubagentStart 必须注册子代理上下文注入');
assert.ok(hooks.SubagentStop, 'SubagentStop 必须注册最终报告校验');
assert.ok(hooks.UserPromptSubmit, 'UserPromptSubmit 必须注册任务级语义路由');

const preToolMatchers = hooks.PreToolUse.map((entry) => entry.matcher);
assert.ok(preToolMatchers.includes('Agent'), '必须对泛化 Agent 调用提供 scoped agent nudge');
assert.ok(preToolMatchers.some((matcher) => matcher.includes('Bash') && matcher.includes('PowerShell')),
  '主/子 Agent 工具边界必须同时覆盖 Bash 和 PowerShell');

const commands = JSON.stringify(hooks);
for (const script of ['session_start.js', 'subagent_start.js', 'subagent_stop.js', 'prompt_inject.js']) {
  assert.ok(commands.includes(script), `hooks.json 必须注册 ${script}`);
}

console.log('✓ hooks_contract.test.js — all assertions passed');
