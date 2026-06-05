#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 CRG 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: CRG CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const { commandExists } = require('../lib/utils');

if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      '本仓库已安装 code-review-graph 图谱。\n' +
      '搜索优先级：CRG → ctx/serena → Grep（用第一个够用的，跳过后面的）\n\n' +
      'CRG — 结构定位，最省 token：\n' +
      '  get_minimal_context_tool    → 概览，首次调用（~100 tokens）\n' +
      '  semantic_search_nodes_tool  → 返回 file_path + line_start/end，再 Read(offset=line_start, limit=N)\n' +
      '  query_graph_tool            → callers/callees/imports\n' +
      '  get_review_context_tool     → 改动影响面，省 ~90% token\n' +
      '  detail_level 默认传 "minimal"\n\n' +
      'ctx/serena — CRG 未命中或需要内容分析时：\n' +
      '  ctx_execute_file            → 大文件统计分析\n' +
      '  serena find_symbol          → 语义 / 跨文件理解\n\n' +
      'Grep — 纯文本 / 字符串字面量 / 注释搜索'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
