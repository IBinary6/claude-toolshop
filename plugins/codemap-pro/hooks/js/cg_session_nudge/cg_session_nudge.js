#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 codegraph 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: codegraph CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const { commandExists, isGitRepo } = require('../lib/utils');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 非 git 仓库 → 静默退出。不要在用户 cwd 下做删除动作。
if (!isGitRepo(cwd)) {
  process.exit(0);
}

if (!commandExists('codegraph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      '本仓库已安装 codegraph 代码图谱（tree-sitter AST，20+ 语言）。\n' +
      'Claude Code 可能延迟加载 MCP schema；当前未显示具体工具时先用 ToolSearch 发现，不能据此断言 CodeGraph 不可用。\n' +
      '图谱同步由 watcher 与 PostToolUse/CwdChanged hook 负责，不要重复 init/sync。\n' +
      '搜索策略：自适应选择一次能回答问题的最小图查询，够用即止。\n\n' +
      'codegraph — AST 结构定位，最省 token：\n' +
      '  任务明确 → 直接调用对应的符号、调用链或引用工具\n' +
      '  任务不明确 → 只做一次最小概览，随后升级到具体查询\n' +
      '  符号搜索 → file_path + 行号；再 Read(offset=行号, limit=N)\n' +
      '  调用/引用查询 → callers/callees/imports\n\n' +
      'serena — LSP 语义（codegraph 未命中）：mcp__serena__find_symbol / find_declaration / find_implementations\n' +
      'ctx_execute_file — 大文件分析沙箱（原始数据不进上下文）\n' +
      'ctx_search — 搜 session 记忆 / 已索引内容\n' +
      'Grep — 纯文本 / 字符串 / 注释（最后手段）'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
