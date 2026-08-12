#!/usr/bin/env node
// ABOUTME: SubagentStart 钩子 - 将 CRG 检索与刷新边界直接注入子代理
// ABOUTME: Claude Code 会把 additionalContext 放进新子代理，而不是只提示主代理

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext:
      'Use adaptive retrieval: choose the tool that can answer the current task in one useful pass.\n\n' +
      'CodeMap Boost owns graph refresh and read barriers. Do not run build/update yourself unless a hook reports failure or the user explicitly requests it.\n' +
      'Claude Code may defer MCP schemas. Use ToolSearch to discover CodeMap tools before claiming they are unavailable.\n\n' +
      'CRG (AST structure):\n' +
      '  Clear task → call semantic_search_nodes, query_graph, get_impact_radius, or detect_changes directly\n' +
      '  Unclear task → get_minimal_context once for routing; do not repeat minimal\n' +
      '  semantic_search_nodes → file_path + line_start/end; Read(offset=line_start, limit=N)\n' +
      '  query_graph           → callers/callees/imports/tests\n' +
      '  detect_changes        → risk-ranked review and affected flows\n' +
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
