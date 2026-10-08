#!/usr/bin/env node
// bugdb_check.js
// PostToolUse / PostToolUseFailure Shell 钩子：用首个错误行只读查库，命中后写
// hookSpecificOutput.additionalContext 注入 [BUGDB_MATCH] 参考。
// 成功输出（PostToolUse）保留原有行为：构建工具常以退出码 0 打印错误；失败一律静默退出 0。

const fs = require('fs');
const { buildContext, firstErrorLine, recallBugs } = require('./bugdb_cli');

/**
 * 提取待检查文本。PostToolUseFailure 用顶层 error（首行 `Exit code N`）；
 * PostToolUse 用 tool_response 的 stdout/stderr。中断（is_interrupt）不是可复用的错误证据。
 * @param {object} input
 * @returns {string}
 * @example
 * failureText({ hook_event_name: 'PostToolUseFailure', error: 'Exit code 1\nLNK2019' }) // 'Exit code 1\nLNK2019'
 */
function failureText(input) {
    if (!input || input.is_interrupt === true) {
        return '';
    }
    if (input.hook_event_name === 'PostToolUseFailure') {
        return String(input.error || '').slice(0, 200000);
    }
    const resp = input.tool_response || {};
    return (String(resp.stdout || '') + '\n' + String(resp.stderr || '')).slice(0, 200000);
}

function main() {
    try {
        // 同步读 stdin，避免 async 与 Claude Code hook 的早退竞争。
        const raw = fs.readFileSync(0, 'utf-8');
        if (!raw || !raw.trim()) return;
        const input = JSON.parse(raw);
        const errorLine = firstErrorLine(failureText(input));
        if (!errorLine) return;
        const recall = recallBugs(errorLine);
        if (!recall.ok || recall.results.length === 0) return;
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: input.hook_event_name === 'PostToolUseFailure'
                    ? 'PostToolUseFailure'
                    : 'PostToolUse',
                additionalContext: buildContext(recall.results[0]),
            },
        }));
    } catch (e) {
        // 静默：stdin 损坏 / Python 缺失 / 超时 / CLI 报错 / JSON 解析失败
    }
}

main();
