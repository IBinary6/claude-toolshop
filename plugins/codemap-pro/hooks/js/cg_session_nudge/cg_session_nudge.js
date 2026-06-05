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
      '本仓库已安装 codegraph 代码图谱（tree-sitter AST，20+ 语言）。\n' +
      '搜索优先级：codegraph → ctx/serena → Grep（用第一个够用的，跳过后面的）\n\n' +
      'codegraph — 结构定位，最省 token：\n' +
      '  mcp__codegraph__*           → 符号搜索（file_path + 行号）、调用链、引用\n' +
      '  得到行号后：Read(offset=行号, limit=N) 精准读，不整文件读\n\n' +
      'ctx/serena — codegraph 未命中或需内容分析时：\n' +
      '  ctx_execute_file            → 大文件统计分析\n' +
      '  serena find_symbol          → 语义 / 跨文件理解\n\n' +
      'Grep — 纯文本 / 字符串字面量 / 注释搜索'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
