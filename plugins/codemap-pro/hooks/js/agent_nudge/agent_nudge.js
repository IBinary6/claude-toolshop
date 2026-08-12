#!/usr/bin/env node
// ABOUTME: SubagentStart 钩子 - 将 CodeGraph 检索边界直接注入新子代理
// ABOUTME: 使用 Claude 原生子代理上下文，不依赖主代理转述

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('codegraph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext:
      'Use adaptive retrieval and choose the smallest useful CodeGraph query for the assigned task.\n' +
      'Claude Code may defer MCP schemas; use ToolSearch before claiming CodeGraph tools are unavailable.\n' +
      'The plugin watcher/PostToolUse hooks own graph synchronization; do not start duplicate init/sync work.\n\n' +
      'codegraph (AST structure):\n' +
      '  Clear task → call the matching symbol/call/reference tool directly\n' +
      '  Unclear task → use the smallest overview once, then move to a specific query\n' +
      '  Symbol search → file_path + line; Read(offset=line, limit=N)\n' +
      '  Call/reference query → callers/callees/imports\n\n' +
      'serena (LSP semantic, when codegraph misses): find_symbol / find_declaration / find_implementations\n' +
      'ctx_execute_file → large file analysis (raw data stays out of context)\n' +
      'ctx_search → session memory / indexed content\n' +
      'Grep → plain text / strings / comments only.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
