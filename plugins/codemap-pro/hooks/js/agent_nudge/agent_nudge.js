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
      'Code navigation guidance for this subagent:\n\n' +
      'codegraph tools (tree-sitter AST, 20+ languages) — use for structure, not content:\n' +
      '- mcp__codegraph__* → symbol search (file + line), callers, callees, references\n' +
      'After getting line numbers: use Read(offset=line, limit=N) — targeted read, not full file\n\n' +
      'When codegraph has no result → serena find_symbol / find_declaration (semantic)\n' +
      'When searching text/strings/comments → Grep\n' +
      'ctx_batch_execute/ctx_execute → large command output only (build logs, git logs)'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
