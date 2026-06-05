#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 CRG 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: CRG CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const fs = require('fs');
const path = require('path');
const { commandExists, isGitRepo } = require('../lib/utils');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 非 git 仓库 → 清理残留目录后静默退出
if (!isGitRepo(cwd)) {
  const residualDirs = ['.code-review-graph', 'graphify-out'];
  for (const d of residualDirs) {
    const full = path.join(cwd, d);
    try { fs.rmSync(full, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(0);
}

if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      '本仓库已安装 code-review-graph 图谱。\n' +
      '搜索优先级：CRG → serena → graphify → ctx → Grep（够用即止）\n\n' +
      'CRG — AST 结构定位，最省 token：\n' +
      '  mcp__code-review-graph__get_minimal_context_tool    → 概览，首次调用\n' +
      '  mcp__code-review-graph__semantic_search_nodes_tool  → file_path + line_start/end；再 Read(offset=line_start, limit=N)\n' +
      '  mcp__code-review-graph__query_graph_tool            → callers/callees/imports/tests\n' +
      '  mcp__code-review-graph__get_review_context_tool     → 改动影响面，省 ~90% token\n\n' +
      'serena — LSP 语义（CRG 未命中）：mcp__serena__find_symbol / find_declaration / find_implementations\n' +
      'graphify — 概念图（serena 也未命中）：query "<概念>" 邻域探索、架构理解、跨文档\n' +
      'ctx_execute_file — 大文件分析沙箱（原始数据不进上下文）\n' +
      'ctx_search — 搜 session 记忆 / 已索引内容\n' +
      'Grep — 纯文本 / 字符串 / 注释（最后手段）'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
