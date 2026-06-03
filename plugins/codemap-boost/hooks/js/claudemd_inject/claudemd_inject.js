#!/usr/bin/env node
// SessionStart hook：幂等地向用户全局 ~/.claude/CLAUDE.md 追加/更新 codemap-boost 触发规则。
// 用版本标记检测旧段落并替换；任何异常都静默 exit 0，绝不阻塞会话。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 缺依赖时后台 pip 自举（detached 预热，不阻塞 SessionStart、不超时）。
// require/调用全程不抛——失败安全降级，绝不阻塞会话。
try {
  require('../lib/ensure_deps').spawnPrewarm();
} catch (_) {}

const SNIPPET_VERSION = 'codemap-boost-snippet-v2';
const SECTION_START = '## 代码结构图触发规则';
const SNIPPET = `

## 代码结构图触发规则
<!-- ${SNIPPET_VERSION} -->

本仓库已安装 code-review-graph + graphify 插件。代码搜索任务优先使用：
- \`mcp__code-review-graph__semantic_search_nodes_tool\` 语义搜索符号
- \`mcp__code-review-graph__query_graph_tool\` 查 callers / callees / imports
- \`mcp__code-review-graph__get_review_context_tool\` 评审改动影响面

仅在 CRG 未命中或纯文本搜索需求时降级到 Grep。

### Token 优化规则（必须遵守）
1. **首次调用必须是** \`get_minimal_context_tool\`（~100 tokens，返回图谱概览+推荐下一步工具）
2. **所有支持 detail_level 的工具默认传 \`detail_level="minimal"\`**，仅在 minimal 输出不足时才升级到 "standard"
3. **每个任务最多 3 次 CRG 工具调用**，除非确实需要更多（如大规模重构评审）
4. 调用顺序：get_minimal_context → 按推荐调用 1-2 个深度工具 → 完成
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

    // codemap-pro 与 codemap-boost 互斥；若 CodeGraph 规则已存在，保持既有优先级。
    if (existing.includes('codemap-pro-snippet')) return;

    // 已是最新版本 -> 不动
    if (existing.includes(SNIPPET_VERSION)) return;

    // 有旧版段落（含 SECTION_START 但无版本标记）-> 替换
    if (existing.includes(SECTION_START)) {
      // 找到旧段落起始位置，截到下一个 ## 标题或文件末尾
      const startIdx = existing.indexOf(SECTION_START);
      // 向前找到段落前的换行（保留前面内容）
      let prefixEnd = startIdx;
      while (prefixEnd > 0 && existing[prefixEnd - 1] === '\n') prefixEnd--;

      // 找旧段落结尾：下一个同级 ## 标题（不含 ###）
      const afterStart = existing.slice(startIdx + SECTION_START.length);
      const nextH2 = afterStart.search(/\n## [^#]/);
      const suffixStart = nextH2 >= 0
        ? startIdx + SECTION_START.length + nextH2
        : existing.length;

      const prefix = existing.slice(0, prefixEnd);
      const suffix = existing.slice(suffixStart);
      fs.writeFileSync(target, prefix + SNIPPET + suffix, 'utf-8');
      return;
    }

    // 全新：追加
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, SNIPPET, 'utf-8');
  } catch (_) {
    // 静默
  }
})();
