'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {
  ROLE_LABELS,
  agentNudge,
  missingReportSections,
  routePrompt,
} = require('../lib/guidance');
const { loadDefaults } = require('../lib/config');

const config = loadDefaults();
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

for (const role of Object.keys(ROLE_LABELS)) {
  const agentFile = path.join(pluginRoot, 'agents', `${role}.md`);
  assert.ok(fs.existsSync(agentFile), `missing agent definition: ${role}`);
  const content = fs.readFileSync(agentFile, 'utf8');
  assert.ok(content.includes(`name: ${role}`), `agent name must match route role: ${role}`);
}

assert.deepEqual(routePrompt('请修复这个普通 bug 并补测试', config), {
  category: 'implementation',
  shouldDispatch: true,
  role: 'dispatch-worker',
});
assert.equal(routePrompt('修复这一行 typo', config).shouldDispatch, false);
assert.equal(routePrompt('全面审查这个权限安全问题', config).role, 'dispatch-deep-reviewer');
assert.equal(routePrompt('实现权限校验并修复安全漏洞', config).role, 'dispatch-planner');
assert.equal(routePrompt('跨模块扫描调用关系', config).role, 'dispatch-mapper');
assert.equal(routePrompt('查找多个文件中的调用链', config).role, 'dispatch-explorer');
assert.equal(routePrompt('分析这个模块', config).role, 'dispatch-explorer');

assert.equal(agentNudge({
  subagent_type: 'agent-dispatch:dispatch-worker',
  prompt: '实现功能',
}, config), '');
assert.ok(agentNudge({ subagent_type: 'general-purpose', prompt: '实现功能' }, config)
  .includes('agent-dispatch:dispatch-worker'));

assert.deepEqual(missingReportSections([
  'Changed files: none',
  'Validation: node --test',
  'Blockers: none',
].join('\n'), config), []);
assert.deepEqual(missingReportSections('Validation: none', config), ['Changed files', 'Blockers']);
assert.deepEqual(missingReportSections([
  '## **修改文件：** none',
  '**验证：** node --test',
  '__阻塞：__ none',
].join('\n'), config), []);

console.log('✓ guidance.test.js — all assertions passed');
