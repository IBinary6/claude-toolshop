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
      '本仓库已安装 code-review-graph 图谱。\n\n' +
      '【用图谱定位符号】\n' +
      '- semantic_search_nodes_tool → 返回 file_path + line_start + line_end + 签名\n' +
      '- query_graph_tool（callers/callees/imports）→ 调用链 / 依赖关系（返回 file_path）\n' +
      '- 得到行号后：Read(offset=line_start, limit=N) 精准读那几行，不要整文件读\n\n' +
      '【影响面分析（Code Review 必用）】\n' +
      '- get_review_context_tool → 改动影响节点、测试覆盖缺口，比逐文件读省 ~90% token\n' +
      '- get_minimal_context_tool → 图谱概览，首次调用用此（~100 tokens）\n\n' +
      '【CRG 不覆盖的场景 → 降级】\n' +
      '- serena find_symbol / find_declaration → 语义理解、接口定义\n' +
      '- Grep → 纯文本 / 字符串字面量 / 注释内容搜索\n' +
      '- ctx_execute_file → 大文件统计分析（不是代码结构搜索）\n\n' +
      '调用顺序：get_minimal_context → semantic_search_nodes → 精准 Read；detail_level 默认传 "minimal"'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
