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
      'Search priority: CRG → serena → graphify → ctx → Grep\n\n' +
      'CRG (AST structure, cheapest):\n' +
      '  get_minimal_context   → overview first\n' +
      '  semantic_search_nodes → file_path + line_start/end; Read(offset=line_start, limit=N)\n' +
      '  query_graph           → callers/callees/imports/tests\n' +
      '  get_review_context    → change impact (~90% token savings)\n\n' +
      'serena (LSP semantic, when CRG misses): find_symbol / find_declaration / find_implementations\n' +
      'graphify (concept graph, when serena misses): query "<concept>" for architecture/cross-doc\n' +
      'ctx_execute_file → large file analysis (raw data stays out of context)\n' +
      'ctx_search → session memory / indexed content\n' +
      'Grep → plain text / strings / comments only'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
