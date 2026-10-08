#!/usr/bin/env node
// bugdb_prompt.js
// UserPromptSubmit 钩子：用户直接贴出编译/链接/运行时错误时，用首个错误行只读查库一次。
// 命中 → 注入 [BUGDB_MATCH]；无命中或召回失败 → 注入一句区分二者的提示，避免模型重复查询
// 或把失败当成“没有历史记录”。不含错误行的提示零开销、零输出。

const fs = require('fs');
const { buildContext, firstErrorLine, recallBugs } = require('./bugdb_cli');

/**
 * 生成本轮注入内容；没有错误行时返回空串。
 * @param {string} prompt 用户原始提示
 * @returns {string}
 * @example
 * promptContext('链接报 error LNK2019: unresolved external symbol foo') // '[BUGDB_MATCH] ...' 或 '[BUGDB_RECALL_HINT] ...'
 */
function promptContext(prompt) {
    const errorLine = firstErrorLine(prompt);
    if (!errorLine) return '';
    const recall = recallBugs(errorLine);
    if (recall.ok && recall.results.length > 0) return buildContext(recall.results[0]);
    if (recall.ok) {
        return '[BUGDB_RECALL_HINT] 已用原始错误行只读查询本地 Bug 知识库，没有命中。继续正常排查，无需改写查询重复召回。';
    }
    return '[BUGDB_RECALL_HINT] 本地 Bug 知识库召回未完成（Python/CLI 不可用或数据库需迁移），不能据此判断是否有历史记录。继续正常排查；需要诊断时运行 /bugdb-setup。';
}

function main() {
    try {
        const raw = fs.readFileSync(0, 'utf-8');
        if (!raw || !raw.trim()) return;
        const input = JSON.parse(raw);
        const context = promptContext(typeof input.prompt === 'string' ? input.prompt : '');
        if (!context) return;
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
        }));
    } catch (e) {
        // 静默：任何异常都不阻塞用户提交
    }
}

main();
