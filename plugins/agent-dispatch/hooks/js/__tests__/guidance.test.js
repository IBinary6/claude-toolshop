'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {
  ROLES,
  ROLE_LABELS,
  agentNudge,
  mainAgentGuidance,
  missingReportSections,
  promptGuidance,
  routePrompt,
  subagentGuidance,
} = require('../lib/guidance');
const { loadDefaults } = require('../lib/config');

const config = loadDefaults();
const pluginRoot = path.resolve(__dirname, '..', '..', '..');

// 路由提示里展示的 model/effort 必须与真实 agent 定义一致，否则主 Agent 会按错误成本选角色。
for (const [role, { model, effort }] of Object.entries(ROLES)) {
  const agentFile = path.join(pluginRoot, 'agents', `${role}.md`);
  assert.ok(fs.existsSync(agentFile), `missing agent definition: ${role}`);
  const content = fs.readFileSync(agentFile, 'utf8');
  assert.ok(content.includes(`name: ${role}`), `agent name must match route role: ${role}`);
  assert.match(content, new RegExp(`^model: ${model}\\r?$`, 'm'), `${role} model must be ${model}`);
  assert.match(content, new RegExp(`^effort: ${effort}\\r?$`, 'm'), `${role} effort must be ${effort}`);
  assert.ok(ROLE_LABELS[role].includes(`${model}/${effort}`), `${role} label must show ${model}/${effort}`);
}
const agentFiles = fs.readdirSync(path.join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, ''));
assert.deepEqual(agentFiles.sort(), Object.keys(ROLES).sort(), 'every shipped agent must be routable');
// 只读角色不能写文件；tester 可运行命令但同样不能改被验收代码。
for (const role of ['dispatch-explorer', 'dispatch-mapper', 'dispatch-researcher', 'dispatch-tester',
  'dispatch-planner', 'dispatch-reviewer', 'dispatch-deep-reviewer']) {
  const content = fs.readFileSync(path.join(pluginRoot, 'agents', `${role}.md`), 'utf8');
  assert.match(content, /^disallowedTools: Edit, Write, MultiEdit, NotebookEdit,/m, `${role} must not edit`);
}

// ---- 常规实现与琐碎改动 ----
{
  const route = routePrompt('请修复这个普通 bug 并补测试', config);
  assert.equal(route.category, 'implementation');
  assert.equal(route.shouldDispatch, true);
  assert.equal(route.role, 'dispatch-worker');
}
assert.equal(routePrompt('修复这一行 typo', config).shouldDispatch, false);
assert.equal(routePrompt('请实现一个 getter', config).shouldDispatch, false);
// 英文按单词边界匹配：prefix 不是 fix，debug 不是 bug。
assert.notEqual(routePrompt('add a prefix to the log label', config).category, 'implementation');

// ---- 产品行为里的“不修改/只读模式”不是任务只读指令 ----
for (const prompt of [
  '请实现产品功能：高度值给个默认值即可，用户不修改就用默认。',
  '请实现只读模式切换：用户不启用只读模式时允许编辑。',
  'Implement the editor option: when the user does not modify the value, keep the default.',
]) {
  const route = routePrompt(prompt, config);
  assert.equal(route.category, 'implementation', prompt);
  assert.equal(route.readOnly, false, prompt);
  assert.match(promptGuidance(prompt, config), /候选建议.*仅据当前消息推断/, prompt);
}
// ---- 真实的只读指令 ----
for (const prompt of ['先不要改代码，只分析问题。', '请只读诊断当前异常，禁止修改文件。', 'For now do not modify code; inspect the implementation.']) {
  const route = routePrompt(prompt, config);
  assert.equal(route.category, 'diagnosis', prompt);
  assert.equal(route.readOnly, true, prompt);
  assert.equal(route.role, 'dispatch-explorer', prompt);
}

// ---- 工具名里的 review / fix 不是任务意图（code-review-graph 在 codemap 用户的提示里极常见）----
for (const prompt of [
  '调用 code-review-graph 的 list_graph_stats_tool，再用 serena 查找符号 add',
  '先用 mcp__plugin_codemap-boost_code-review-graph__query_graph_tool 看一下调用关系',
]) {
  const route = routePrompt(prompt, config);
  assert.notStrictEqual(route.category, 'review', prompt);
  assert.ok(!/审查/.test(promptGuidance(prompt, config)), prompt);
}
assert.equal(routePrompt('请 review 这个补丁', config).category, 'review', '真正的 review 请求仍要路由');

// ---- 风险词不自动升级到 opus ----
{
  const review = routePrompt('全面审查这个权限安全问题', config);
  assert.equal(review.category, 'high-risk-review');
  assert.equal(review.role, 'dispatch-reviewer', 'risk keywords alone must not pick the opus reviewer');
  assert.match(promptGuidance('全面审查这个权限安全问题', config), /dispatch-deep-reviewer.*风险关键词本身不要求升级/);
  const fix = routePrompt('实现权限校验并修复安全漏洞', config);
  assert.equal(fix.category, 'high-risk-implementation');
  assert.equal(fix.role, 'dispatch-worker');
  assert.match(promptGuidance('实现权限校验并修复安全漏洞', config), /主 Agent 先核对真实调用路径/);
}
assert.equal(routePrompt('修复单文件权限缺陷', config).category, 'primary-risk');
assert.equal(routePrompt('只改 README 中 security 一词的拼写', config).shouldDispatch, false);

// ---- 困难任务：不因困难而强制规划 ----
assert.equal(routePrompt('编写一个复杂 JSON 处理器', config).role, 'dispatch-hard-worker');
assert.equal(routePrompt('请先制定计划然后实现用户模块', config).role, 'dispatch-planner');
assert.equal(routePrompt('按已有计划实现跨模块迁移', config).category === 'plan', false, 'existing plan must not be re-planned');

// ---- 搜索与调查 ----
assert.equal(routePrompt('跨模块扫描调用关系', config).role, 'dispatch-mapper');
assert.equal(routePrompt('分析这个模块', config).role, 'dispatch-explorer');
assert.equal(routePrompt('查找单个符号 Foo', config).shouldDispatch, false, 'exact narrow lookup is primary work');

// ---- 低成本证据：haiku 角色承接，按是否需要执行命令区分 ----
for (const [prompt, kind, role] of [
  ['检索最近构建日志并摘录失败原因', 'logs', 'dispatch-tester'],
  ['运行现有 CTest 用例，汇总失败输出', 'established-tests', 'dispatch-tester'],
  ['查找源码中所有调用方和影响面', 'code-evidence', 'dispatch-explorer'],
  ['读取这些 Markdown 文档，汇总重复条目', 'documents', 'dispatch-explorer'],
  ['从 CSV 提取字段并去重统计', 'structured-data', 'dispatch-explorer'],
  ['按模板批量更新文档中的版本号', 'documents', 'dispatch-worker'],
]) {
  const route = routePrompt(prompt, config);
  assert.equal(route.category, 'low-cost', prompt);
  assert.equal(route.lowCostKind, kind, prompt);
  assert.equal(route.role, role, prompt);
  assert.match(promptGuidance(prompt, config), /低成本/, prompt);
}
// 混合任务只把证据阶段降级
{
  const mixed = routePrompt('根据构建日志修复复杂崩溃，并补回归测试', config);
  assert.equal(mixed.category, 'hard-task');
  assert.equal(mixed.lowCostEvidence, true);
  const guidance = promptGuidance('根据构建日志修复复杂崩溃，并补回归测试', config);
  assert.match(guidance, /证据子任务交给 agent-dispatch:dispatch-tester/);
  assert.match(guidance, /dispatch-hard-worker/);
}
// 写测试是代码写作，不是低成本测试执行
assert.equal(routePrompt('写单元测试覆盖新的接口行为', config).category, 'implementation');
assert.equal(routePrompt('写单元测试覆盖新的接口行为', config).lowCostEvidence, false);

// ---- 验证与外部研究 ----
assert.equal(routePrompt('执行既定测试验收结账流程', config).role, 'dispatch-tester');
assert.equal(routePrompt('Run the existing test suite against the prototype', config).category, 'verification');
assert.equal(routePrompt('从官方来源研究竞品价格', config).role, 'dispatch-researcher');

// ---- 用户约束与主 Agent 专属 ----
assert.equal(routePrompt('只用主代理检索构建日志，不要子代理', config).category, 'primary-only');
assert.equal(promptGuidance('只用主代理检索构建日志，不要子代理', config), '');
assert.equal(promptGuidance('请优化 Agent Dispatch 的路由策略配置', config), '', 'policy discussion is primary work');
assert.equal(promptGuidance('这是一段需要保留的原文。'.repeat(30), config), '', 'length alone does not request delegation');
assert.match(promptGuidance('请帮我审查并迁移这个多文件插件，最多一个子代理', config), /代理数量或并行限制优先/);

// ---- 纯 Git CLI 中的 fix/review 是参数，不是任务意图 ----
for (const command of ['git commit -m "fix: update parser"', 'git log --grep=review', 'git.exe status']) {
  const route = routePrompt(command, config);
  assert.equal(route.shouldDispatch, false, command);
  assert.equal(route.reason, 'pure Git CLI command', command);
}
assert.equal(routePrompt('git status && rg architecture', config).shouldDispatch, true, 'mixed commands stay routable');

// ---- 主 / 子代理指导 ----
{
  const main = mainAgentGuidance(config);
  assert.match(main, /候选建议/);
  assert.match(main, /haiku/);
  assert.match(main, /不因审查或风险关键词自动升级到 opus/);
  assert.match(main, /third_party/);
  const sub = subagentGuidance(config);
  assert.match(sub, /不要运行任何 Git 命令/);
  assert.match(sub, /不自行升级模型/);
  assert.match(sub, /Changed files/);
}

// ---- agentNudge ----
assert.equal(agentNudge({ subagent_type: 'agent-dispatch:dispatch-worker', prompt: '实现功能' }, config), '');
assert.equal(agentNudge({ subagent_type: 'dispatch-tester', prompt: '运行现有测试' }, config), '');
assert.ok(agentNudge({ subagent_type: 'general-purpose', prompt: '实现功能' }, config)
  .includes('agent-dispatch:dispatch-worker'));

// ---- 报告小节 ----
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
