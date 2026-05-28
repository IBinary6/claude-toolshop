// bugdb_check.js
// PostToolUse:Bash 钩子。检测错误关键词后查询 BugDB，命中时注入 [BUGDB_MATCH] 提示。
// 失败静默：任何异常都不阻塞主流程。

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(os.homedir(), '.claude', 'plugins', 'bugdb-knowledge');
const CLI_PATH = path.join(PLUGIN_ROOT, 'scripts', 'bugdb', 'cli.py');

// 智能预过滤：99% Bash 调用零开销
const ERROR_PATTERN = /\b(error\s*[CE]\d{4}|LNK\d{4}|fatal error|FAILED|error\[E\d+\]|unresolved external|undefined reference|segmentation fault|access violation|ModuleNotFoundError|No module named)\b/i;

function runSearch(errorLine) {
    // 用 base64 包装传参，彻底避免引号/换行/反斜杠注入
    // 不传 --language：Hook 无法可靠推断错误语言，让 CLI 默认跨语言搜索
    const payload = Buffer.from(errorLine, 'utf-8').toString('base64');
    return execSync(
        `python "${CLI_PATH}" search --query-b64 ${payload} --format json`,
        { timeout: 4000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
}

module.exports = async function bugdbCheck(context) {
    try {
        const { stdout = '', stderr = '' } = (context && context.toolResult) || {};
        const output = String(stdout) + String(stderr);

        if (!ERROR_PATTERN.test(output)) {
            return { continue: true };
        }

        const errorLine = output.split('\n').find(line => ERROR_PATTERN.test(line)) || '';
        if (!errorLine.trim()) {
            return { continue: true };
        }

        const raw = runSearch(errorLine);
        const data = JSON.parse(raw);
        if (!data.results || data.results.length === 0) {
            return { continue: true };
        }

        const top = data.results[0];
        const stepsJson = JSON.stringify(top.action_steps || []);
        let out = `[BUGDB_MATCH] id=${top.id} confidence=${top.confidence} status=${top.status}\n`;
        out += `entry_kind=${top.entry_kind}\n`;
        out += `category=${top.category}\n`;
        out += `content=${String(top.content || '').replace(/\r?\n/g, ' ')}\n`;
        out += `steps=${stepsJson}\n`;
        if (top.replacement_id) {
            out += `replacement_id=${top.replacement_id}\n`;
        }
        out += `hint=如方案无效，忽略此提示继续正常排查`;
        return { continue: true, output: out };
    } catch (e) {
        // 静默：Python 缺失 / 超时 / DB 不存在 / CLI 报错 / JSON 解析失败
        return { continue: true };
    }
};
