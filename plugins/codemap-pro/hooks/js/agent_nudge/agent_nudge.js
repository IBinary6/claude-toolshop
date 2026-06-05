#!/usr/bin/env node
// ABOUTME: PreToolUse:Agent 钩子 - 派遣子代理时注入 codegraph 优先规则
// ABOUTME: 不阻断 Agent 工具, 仅追加 additionalContext 软提示

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('codegraph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext:
      'Search priority: codegraph → serena → ctx → Grep\n\n' +
      'codegraph (AST structure, cheapest):\n' +
      '  mcp__codegraph__* symbol search → file_path + line; Read(offset=line, limit=N)\n' +
      '  mcp__codegraph__* call chain    → callers/callees/imports\n\n' +
      'serena (LSP semantic, when codegraph misses): find_symbol / find_declaration / find_implementations\n' +
      'ctx_execute_file → large file analysis (raw data stays out of context)\n' +
      'ctx_search → session memory / indexed content\n' +
      'Grep → plain text / strings / comments only'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
