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
      'MANDATORY for this subagent: Use codegraph MCP tools for code structure — ' +
      'do NOT use Grep or ctx_batch_execute for symbol/structural lookup:\n' +
      '- Use available mcp__codegraph__* tools for symbol search, callers, callees, and references\n' +
      '- codegraph uses tree-sitter AST, supports 20+ languages, faster than text search\n' +
      'Fallback order when codegraph has no result: mcp__serena__find_symbol (semantic) → Grep (plain-text only). ' +
      'ctx_batch_execute/ctx_execute = large command output (build logs, git logs) ONLY.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
