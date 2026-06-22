#!/usr/bin/env node
// bugdb_check.js
// PostToolUse:Bash 钩子。Claude Code 通过 stdin 传入 JSON，hook 命中后向 stdout
// 写 hookSpecificOutput.additionalContext 将 [BUGDB_MATCH] 提示注入到模型上下文。
// 失败一律静默退出 0，不阻塞主流程。

const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
    || path.join(os.homedir(), '.claude', 'plugins', 'bugdb-knowledge');
const CLI_PATH = path.join(PLUGIN_ROOT, 'bugdb', 'cli.py');

// 智能预过滤：99% Bash 调用零开销
const ERROR_PATTERN = /\b(error\s*[CE]\d{4}|LNK\d{4}|fatal error|FAILED|error\[E\d+\]|unresolved external|undefined reference|segmentation fault|access violation|ModuleNotFoundError|No module named)\b/i;

function splitArgs(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function pythonCandidates() {
    if (process.env.BUGDB_PYTHON) {
        return [{ cmd: process.env.BUGDB_PYTHON, args: splitArgs(process.env.BUGDB_PYTHON_ARGS) }];
    }
    const candidates = [
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] },
    ];
    if (process.platform === 'win32') {
        candidates.push({ cmd: 'py', args: ['-3.11'] });
    }
    return candidates;
}

function readStdinSync() {
    // 同步读 stdin，避免 async 与 Claude Code hook 的早退竞争。
    try {
        return require('fs').readFileSync(0, 'utf-8');
    } catch (e) {
        return '';
    }
}

function runSearch(errorLine) {
    // base64 包装传参，避免引号/换行/反斜杠注入到 shell。
    const payload = Buffer.from(errorLine, 'utf-8').toString('base64');
    for (const py of pythonCandidates()) {
        const res = spawnSync(py.cmd, [...py.args, CLI_PATH, 'search', '--query-b64', payload, '--format', 'json'], {
            timeout: 4000,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (res.status === 0 && res.stdout) {
            return res.stdout;
        }
    }
    return null;
}

function buildContext(top) {
    const stepsJson = JSON.stringify(top.action_steps || []);
    let ctx = `[BUGDB_MATCH] id=${top.id} confidence=${top.confidence} status=${top.status}\n`;
    ctx += `entry_kind=${top.entry_kind}\n`;
    ctx += `category=${top.category}\n`;
    ctx += `content=${String(top.content || '').replace(/\r?\n/g, ' ')}\n`;
    ctx += `steps=${stepsJson}\n`;
    if (top.replacement_id) {
        ctx += `replacement_id=${top.replacement_id}\n`;
    }
    ctx += `hint=如方案无效，忽略此提示继续正常排查`;
    return ctx;
}

function main() {
    try {
        const raw = readStdinSync();
        if (!raw || !raw.trim()) {
            return;
        }
        const input = JSON.parse(raw);
        // Claude Code PostToolUse 标准字段：tool_response 内含 stdout/stderr。
        const resp = (input && input.tool_response) || {};
        const output = String(resp.stdout || '') + String(resp.stderr || '');

        if (!ERROR_PATTERN.test(output)) {
            return;
        }
        const errorLine = output.split('\n').find(line => ERROR_PATTERN.test(line)) || '';
        if (!errorLine.trim()) {
            return;
        }
        const cliOut = runSearch(errorLine);
        if (!cliOut) {
            return;
        }
        const data = JSON.parse(cliOut);
        if (!data.results || data.results.length === 0) {
            return;
        }
        const additionalContext = buildContext(data.results[0]);
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext,
            },
        }));
    } catch (e) {
        // 静默：stdin 无数据 / Python 缺失 / 超时 / DB 不存在 / CLI 报错 / JSON 解析失败
    }
}

main();
