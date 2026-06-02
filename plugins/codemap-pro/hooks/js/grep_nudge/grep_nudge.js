#!/usr/bin/env node
// ABOUTME: PreToolUse:Grep 钩子 - 每次 Grep 都提示优先用 CodeGraph MCP 工具搜索
// ABOUTME: codegraph CLI 不在 PATH 时静默退出, 永不阻塞 Grep
//
// 每次触发: 输出 hookSpecificOutput.additionalContext JSON + exit 0
//   - additionalContext 是 PreToolUse 官方"给模型注入推理上下文"字段, 比 systemMessage 更可靠进入思考
//   - 不带 permissionDecision -> 仍放行 Grep (软提示, 不 deny)
// codegraph CLI 不在 PATH -> 没必要推 CodeGraph 工具, 静默退出

'use strict';

const { commandExists } = require('../lib/utils');

// codegraph CLI 不在 PATH -> 没必要推 CodeGraph 工具, 静默退出
if (!commandExists('codegraph')) {
  process.exit(0);
}

// 通过 additionalContext 提示 Claude: 代码结构查询优先用 CodeGraph, Grep 只用于文本搜索
// 仅注入上下文, 不带 permissionDecision -> Grep 仍被放行
const payload = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext:
      'Use mcp__codegraph for code structure (symbols/calls/refs). Grep only for text/comments.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
