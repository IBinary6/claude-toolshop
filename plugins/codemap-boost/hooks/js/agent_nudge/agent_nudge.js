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
      'SUBAGENT PROMPT MUST include CRG rules: ' +
      '(1) First call mcp__code-review-graph__get_minimal_context_tool(detail_level="minimal"). ' +
      '(2) Symbols/functions/classes/calls → semantic_search_nodes_tool or query_graph_tool. ' +
      '(3) Grep only for plain-text/string/comment search. ' +
      '(4) Max 3 CRG calls per task.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
