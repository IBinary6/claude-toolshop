#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 codegraph 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: codegraph CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('codegraph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      '本仓库已安装 codegraph 代码图谱（tree-sitter AST，20+ 语言）。代码搜索任务优先使用图谱工具（更省 token、更精准）：\n' +
      '- 使用 mcp__codegraph__* 工具进行符号搜索、调用链查询、引用分析\n' +
      '- codegraph 基于 AST 精准解析，比文本搜索快 10 倍\n' +
      '仅在 codegraph 未命中时降级：先用 mcp__serena__* 语义搜索（find_symbol/find_declaration），' +
      '纯文本/字符串/注释搜索才降级到 Grep。\n' +
      'Token 优化规则（必须遵守）：\n' +
      '1. 代码结构搜索先用 codegraph MCP 工具，不要直接 Grep\n' +
      '2. ctx_batch_execute/ctx_execute 用于处理大体积命令输出（build log/git log/大 JSON），' +
      '代码结构搜索用图谱而非 ctx 工具。'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
