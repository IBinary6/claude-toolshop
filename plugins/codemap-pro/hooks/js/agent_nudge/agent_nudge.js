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
      'Search priority: codegraph → ctx/serena → Grep (use the first that fits, skip the rest)\n\n' +
      'codegraph — structure & location (most token-efficient):\n' +
      '  mcp__codegraph__*  → symbol search (file_path + line); then Read(offset=line, limit=N)\n\n' +
      'ctx/serena — when codegraph misses or content analysis needed:\n' +
      '  ctx_execute_file   → large file stats/analysis\n' +
      '  serena find_symbol → semantic/cross-file understanding\n\n' +
      'Grep — plain text / strings / comments only'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
