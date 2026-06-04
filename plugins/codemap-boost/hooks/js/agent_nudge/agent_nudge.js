#!/usr/bin/env node
// ABOUTME: PreToolUse:Agent 钩子 - 派遣子代理时注入 CRG 优先规则
// ABOUTME: 不阻断 Agent 工具, 仅追加 additionalContext 软提示

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext:
      'MANDATORY for this subagent: Use code-review-graph MCP tools for code structure — ' +
      'do NOT use Grep or ctx_batch_execute for symbol/structural lookup:\n' +
      '- Start: mcp__code-review-graph__get_minimal_context_tool (~100 tokens)\n' +
      '- Symbol/function/class: mcp__code-review-graph__semantic_search_nodes_tool\n' +
      '- Callers/callees/imports: mcp__code-review-graph__query_graph_tool\n' +
      '- Change impact: mcp__code-review-graph__detect_changes_tool or get_impact_radius_tool\n' +
      'Fallback order when CRG has no result: mcp__serena__find_symbol (semantic) → Grep (plain-text only). ' +
      'ctx_batch_execute/ctx_execute = large command output (build logs, git logs) ONLY.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
