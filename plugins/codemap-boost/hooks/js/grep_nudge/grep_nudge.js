#!/usr/bin/env node
// ABOUTME: PreToolUse:Grep 钩子 - 每次 Grep 都提示优先用 CRG 图谱搜索
// ABOUTME: CRG 不在 PATH 时静默退出, 永不阻塞 Grep
//
// 每次触发: 输出 systemMessage JSON + exit 0 (无控频, 保证每次都提醒)
// CRG CLI 不在 PATH -> 静默 exit 0 (commandExists)

'use strict';

const { commandExists } = require('../lib/utils');

// CRG CLI 不在 PATH -> 没必要推 CRG 工具, 静默退出
if (!commandExists('code-review-graph')) {
  process.exit(0);
}

// 输出 systemMessage 通知 Claude 优先用 CRG
const payload = {
  continue: true,
  systemMessage: 'CRG indexed: prefer mcp__code-review-graph__semantic_search_nodes_tool / query_graph_tool over Grep for symbol/call lookups.'
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
