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
      'Code navigation guidance for this subagent:\n\n' +
      'CRG tools (code-review-graph) — use for structure, not content:\n' +
      '- get_minimal_context_tool → graph overview, call first (~100 tokens)\n' +
      '- semantic_search_nodes_tool → returns file_path + line_start + line_end + signature\n' +
      '- query_graph_tool → callers / callees / imports (returns file_path)\n' +
      '- get_review_context_tool → change impact + test gaps (~90% token savings vs reading files)\n' +
      'After getting line numbers: use Read(offset=line_start, limit=N) — targeted read, not full file\n\n' +
      'When CRG has no result → serena find_symbol / find_declaration (semantic)\n' +
      'When searching text/strings/comments → Grep\n' +
      'ctx_batch_execute/ctx_execute → large command output only (build logs, git logs)'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
