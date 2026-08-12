#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 会话开始时注入 CRG 优先规则（一次性，替代 CLAUDE.md 写入）
// ABOUTME: CRG CLI 不在 PATH 时静默退出，不阻塞会话启动

'use strict';

const { commandExists, isGitRepo } = require('../lib/utils');

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 非 git 仓库 → 静默退出。不要在用户 cwd 下做删除动作。
if (!isGitRepo(cwd)) {
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
      'CodeMap Boost 负责图刷新与读前屏障；除非 hook 明确失败或用户要求，不要自行 build/update。\n' +
      'Claude Code 默认可能延迟加载 MCP schema；当前未看到具体工具时先用 ToolSearch 发现，不能据此断言 CodeMap 不可用。\n' +
      '搜索策略：自适应检索，优先选择一次就能回答当前问题的工具；够用即止。\n\n' +
      'CRG — AST 结构定位：\n' +
      '  任务明确 → 直接调用 semantic_search_nodes / query_graph / get_impact_radius / detect_changes\n' +
      '  任务不明确 → get_minimal_context_tool 仅调用一次用于路由，不要反复 minimal\n' +
      '  mcp__code-review-graph__semantic_search_nodes_tool  → file_path + line_start/end；再 Read(offset=line_start, limit=N)\n' +
      '  mcp__code-review-graph__query_graph_tool            → callers/callees/imports/tests\n' +
      '  mcp__code-review-graph__detect_changes_tool         → 风险排序审查、影响流与测试缺口\n' +
      '若 minimal 缺少有效实体、文件、关系或下一步工具，立即升级到更完整工具或 detail_level="standard"，不要再次调用 minimal。\n\n' +
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
