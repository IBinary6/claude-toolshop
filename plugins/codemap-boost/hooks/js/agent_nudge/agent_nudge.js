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
      'Use adaptive retrieval: choose the tool that can answer the current task in one useful pass.\n\n' +
      'CRG (AST structure):\n' +
      '  Clear task → call semantic_search_nodes, query_graph, get_impact_radius, or get_review_context directly\n' +
      '  Unclear task → get_minimal_context once for routing; do not repeat minimal\n' +
      '  semantic_search_nodes → file_path + line_start/end; Read(offset=line_start, limit=N)\n' +
      '  query_graph           → callers/callees/imports/tests\n' +
      '  get_review_context    → change impact (~90% token savings)\n' +
      'If minimal lacks a useful entity, file, relationship, or next tool, immediately upgrade to a fuller tool or detail_level="standard"; never probe with minimal repeatedly.\n\n' +
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
