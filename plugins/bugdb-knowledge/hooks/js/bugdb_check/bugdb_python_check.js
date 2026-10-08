#!/usr/bin/env node
// bugdb_python_check.js
// SessionStart 钩子。bugdb-knowledge 的真正前置是 Python 3.11+ 解释器（无第三方包）。
// 会话启动时轻量探测一次：所有候选都缺失或低于 3.11 时，向 stdout 写
// hookSpecificOutput.additionalContext，给 Claude 一句温和提示引导用户跑 /bugdb-setup。
// 绝不拦截、绝不 block，任何情况都 exit 0。

const { detectPython } = require('./bugdb_cli');

/**
 * 生成缺少 Python 3.11+ 时的提示。
 * @param {{version:string|null}} detected
 * @returns {string}
 * @example
 * buildHint({ version: '3.9.7' }) // '[BUGDB_SETUP_HINT] ... 检测到 Python 3.9.7（低于要求的 3.11）...'
 */
function buildHint(detected) {
    const where = detected.version
        ? `检测到 Python ${detected.version}（低于要求的 3.11）`
        : '未检测到可用的 Python';
    return `[BUGDB_SETUP_HINT] bugdb-knowledge 需要 Python 3.11+，当前${where}。`
        + `运行 /bugdb-setup 可检测并（在征得你同意后）协助安装。`
        + `在此之前，命令失败与粘贴错误时的自动查库无法完成，不影响其它工作。`;
}

function main() {
    try {
        const detected = detectPython();
        if (detected.ok) {
            return; // 满足前置，静默
        }
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: buildHint(detected),
            },
        }));
    } catch (e) {
        // 任何异常都静默，绝不阻塞会话启动
    }
}

main();
