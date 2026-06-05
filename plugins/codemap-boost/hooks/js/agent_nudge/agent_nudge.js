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
      'Search priority: CRG → ctx/serena → Grep (use the first that fits, skip the rest)\n\n' +
      'CRG — structure & location (most token-efficient):\n' +
      '  get_minimal_context_tool   → overview, call first (~100 tokens)\n' +
      '  semantic_search_nodes_tool → file_path + line_start/end; then Read(offset=line_start, limit=N)\n' +
      '  query_graph_tool           → callers/callees/imports\n' +
      '  get_review_context_tool    → impact analysis (~90% token savings)\n\n' +
      'ctx/serena — when CRG misses or content analysis needed:\n' +
      '  ctx_execute_file           → large file stats/analysis\n' +
      '  serena find_symbol         → semantic/cross-file understanding\n\n' +
      'Grep — plain text / strings / comments only'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
