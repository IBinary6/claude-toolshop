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
      'SUBAGENT PROMPT MUST include codegraph rules: ' +
      '(1) Use mcp__codegraph tools first for all symbol/function/class/call/reference lookups. ' +
      '(2) Grep only for plain-text/string/comment search. ' +
      '(3) Max 3 codegraph calls per task.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
