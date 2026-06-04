#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 CRG 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: CRG CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      '本仓库已安装 code-review-graph 图谱。代码搜索任务优先使用图谱工具（更省 token、更精准）：\n' +
      '- mcp__code-review-graph__semantic_search_nodes_tool（符号语义搜索）\n' +
      '- mcp__code-review-graph__query_graph_tool（callers/callees/imports）\n' +
      '- mcp__code-review-graph__get_review_context_tool（改动影响面）\n' +
      '仅在 CRG 未命中或纯文本搜索时降级到 Grep。\n' +
      'Token 优化规则（必须遵守）：\n' +
      '1. 首次调用必须是 get_minimal_context_tool（~100 tokens，返回图谱概览）\n' +
      '2. 所有支持 detail_level 的工具默认传 detail_level="minimal"\n' +
      'ctx_batch_execute/ctx_execute 用于处理大体积命令输出（build log/git log/大 JSON），' +
      '代码结构搜索用图谱而非 ctx 工具。'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
