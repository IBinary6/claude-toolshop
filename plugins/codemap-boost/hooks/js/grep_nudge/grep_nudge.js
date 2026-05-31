#!/usr/bin/env node
// ABOUTME: PreToolUse:Grep 钩子 - 每次 Grep 都提示优先用 CRG 图谱搜索
// ABOUTME: CRG 不在 PATH 时静默退出, 永不阻塞 Grep
//
// 每次触发: 输出 hookSpecificOutput.additionalContext JSON + exit 0
//   - additionalContext 是 PreToolUse 官方"给模型注入推理上下文"字段, 比 systemMessage 更可靠进入思考
//   - 不带 permissionDecision -> 仍放行 Grep (软提示, 不 deny)
// CRG CLI 不在 PATH -> 静默 exit 0 (commandExists)

'use strict';

const { commandExists } = require('../lib/utils');

// CRG CLI 不在 PATH -> 没必要推 CRG 工具, 静默退出
if (!commandExists('code-review-graph')) {
  process.exit(0);
}

// 通过 additionalContext 强制提示 Claude: 代码符号/调用/引用查找必须用 CRG, 不用 Grep
// 仅注入上下文, 不带 permissionDecision -> Grep 仍被放行
const payload = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext:
      'MUST use mcp__code-review-graph__semantic_search_nodes_tool / query_graph_tool ' +
      'for symbol, function, class, call, and reference lookups — NOT Grep. ' +
      'Grep is only for plain-text/string/comment search. ' +
      'CRG is indexed and authoritative for code structure.'
  }
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
