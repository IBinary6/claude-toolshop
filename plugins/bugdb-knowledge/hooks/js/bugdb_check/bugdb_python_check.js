#!/usr/bin/env node
// bugdb_python_check.js
// SessionStart 钩子。bugdb-knowledge 的真正前置是 Python 3.11+ 解释器（无第三方包）。
// 会话启动时轻量探测一次：python 缺失或版本 < 3.11 时，向 stdout 写
// hookSpecificOutput.additionalContext，给 Claude 一句温和提示引导用户跑 /bugdb-setup。
// 绝不拦截、绝不 block，任何情况都 exit 0。

const { spawnSync } = require('child_process');

const MIN_MAJOR = 3;
const MIN_MINOR = 11;

function detectPython() {
    // 返回 { ok, version } —— ok 表示存在且 >= 3.11。
    const py = process.env.BUGDB_PYTHON || 'python';
    let res;
    try {
        res = spawnSync(py, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], {
            timeout: 3000,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch (e) {
        return { ok: false, version: null };
    }
    if (!res || res.status !== 0 || !res.stdout) {
        return { ok: false, version: null };
    }
    const version = res.stdout.trim();
    const m = version.match(/^(\d+)\.(\d+)\./);
    if (!m) {
        return { ok: false, version };
    }
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const ok = major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
    return { ok, version };
}

function buildHint(detected) {
    const where = detected.version
        ? `检测到 Python ${detected.version}（低于要求的 3.11）`
        : '未检测到可用的 Python';
    return `[BUGDB_SETUP_HINT] bugdb-knowledge 需要 Python 3.11+，当前${where}。`
        + `运行 /bugdb-setup 可检测并（在征得你同意后）协助安装。`
        + `在此之前，PostToolUse 自动查库会静默跳过，不影响其它工作。`;
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
