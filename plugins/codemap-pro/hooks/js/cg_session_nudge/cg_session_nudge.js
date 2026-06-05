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
      '本仓库已安装 codegraph 代码图谱（tree-sitter AST，20+ 语言）。\n\n' +
      '【用图谱定位符号和关系】\n' +
      '- mcp__codegraph__* → 符号搜索（文件路径 + 行号）、调用链、引用分析\n' +
      '- 得到位置后：Read(offset=行号, limit=N) 精准读目标代码，不要整文件读\n\n' +
      '【codegraph 不覆盖的场景 → 降级】\n' +
      '- serena find_symbol / find_declaration → 语义理解、接口定义\n' +
      '- Grep → 纯文本 / 字符串字面量 / 注释内容搜索\n' +
      '- ctx_execute_file → 大文件统计分析（不是代码结构搜索）\n\n' +
      '搜索优先级：codegraph 定位 → serena 语义 → Grep 纯文本\n' +
      'ctx_batch_execute/ctx_execute 仅用于大体积命令输出（build log / git log / 大 JSON）'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
