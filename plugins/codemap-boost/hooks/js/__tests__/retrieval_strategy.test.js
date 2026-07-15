'use strict';

// ABOUTME: 保证 Claude 侧三个运行时提示维持与 Codex 侧接近的自适应检索语义。

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const hookRoot = path.join(__dirname, '..');
const sources = [
  path.join(hookRoot, 'crg_session_nudge', 'crg_session_nudge.js'),
  path.join(hookRoot, 'agent_nudge', 'agent_nudge.js'),
  path.join(hookRoot, 'grep_nudge', 'grep_nudge.js'),
].map((file) => fs.readFileSync(file, 'utf8'));

for (const source of sources) {
  assert.match(source, /adaptive|自适应检索/i, '提示必须声明自适应检索');
  assert.match(source, /once|一次/, 'minimal 只能作为一次性路由入口');
  assert.match(source, /do not repeat minimal|不要反复 minimal|不要再次调用 minimal/i, '提示必须禁止重复 minimal');
  assert.match(source, /standard/, '信息不足时必须升级到 standard');
  assert.match(source, /semantic_search_nodes|query_graph/, '提示必须保留结构化图谱工具');
}

console.log('retrieval_strategy.test.js PASS');
