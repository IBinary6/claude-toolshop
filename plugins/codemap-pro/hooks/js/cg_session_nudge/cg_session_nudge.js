#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 codegraph 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: codegraph CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const fs = require('fs');
const path = require('path');
const { commandExists, isGitRepo } = require('../lib/utils');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 非 git 仓库 → 清理残留目录后静默退出
if (!isGitRepo(cwd)) {
  const residualDirs = ['.codegraph'];
  for (const d of residualDirs) {
    const full = path.join(cwd, d);
    try { fs.rmSync(full, { recursive: true, force: true }); } catch (_) {}
  }
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
      '搜索优先级：codegraph → serena → ctx → Grep（够用即止）\n\n' +
      'codegraph — AST 结构定位，最省 token：\n' +
      '  mcp__codegraph__* 符号搜索 → file_path + 行号；再 Read(offset=行号, limit=N)\n' +
      '  mcp__codegraph__* 调用链   → callers/callees/imports\n\n' +
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
