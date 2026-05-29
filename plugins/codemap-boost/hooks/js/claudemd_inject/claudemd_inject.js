#!/usr/bin/env node
// SessionStart hook：幂等地向用户全局 ~/.claude/CLAUDE.md 追加 codemap-boost 触发规则。
// 已包含关键字（code-review-graph）则跳过；任何异常都静默 exit 0，绝不阻塞会话。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'code-review-graph';
const SNIPPET = `

## 代码结构图触发规则

本仓库已安装 code-review-graph + graphify 插件。代码搜索任务优先使用：
- \`mcp__code-review-graph__semantic_search_nodes_tool\` 语义搜索符号
- \`mcp__code-review-graph__query_graph_tool\` 查 callers / callees / imports
- \`mcp__code-review-graph__get_review_context_tool\` 评审改动影响面

仅在 CRG 未命中或纯文本搜索需求时降级到 Grep。
`;

(function main() {
  try {
    const target = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    let existing = '';
    try {
      existing = fs.readFileSync(target, 'utf-8');
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }
    if (existing.includes(MARKER)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, SNIPPET, 'utf-8');
  } catch (_) {
    // 静默
  }
})();
