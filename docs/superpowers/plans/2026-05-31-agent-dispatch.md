# agent-dispatch 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 agent-dispatch 插件，白名单制强制主 agent 委派工作给子代理，保护上下文窗口。

**Architecture:** 单 PreToolUse 钩子（enforcer）+ 可选 UserPromptSubmit（prompt inject）。配置两层合并：内置默认 + 项目级覆盖。纯 Node.js，零外部依赖。

**Tech Stack:** Node.js 18+, Claude Code Hook Protocol (stdin JSON → stdout JSON/text)

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `plugins/agent-dispatch/hooks/hooks.json` | 钩子注册 |
| `plugins/agent-dispatch/hooks/js/enforcer.js` | 主执行钩子：白名单检查 + Bash 分析 + block |
| `plugins/agent-dispatch/hooks/js/prompt_inject.js` | 可选：注入 dispatcher 指令 |
| `plugins/agent-dispatch/hooks/js/lib/utils.js` | 共享工具：readStdinJson / output / log |
| `plugins/agent-dispatch/hooks/js/lib/config.js` | 配置加载与合并 |
| `plugins/agent-dispatch/hooks/js/lib/rules.js` | 规则匹配引擎：白名单 / Bash 分析 |
| `plugins/agent-dispatch/defaults/dispatch-rules.json` | 内置默认规则 |
| `plugins/agent-dispatch/commands/agent-dispatch-setup.md` | Setup skill |
| `plugins/agent-dispatch/README.md` | 完整文档 |
| `plugins/agent-dispatch/docs/MANUAL_INSTALL.md` | 手动安装指南 |

---

### Task 1: 基础骨架 + hooks.json

**Files:**
- Create: `plugins/agent-dispatch/hooks/hooks.json`
- Create: `plugins/agent-dispatch/hooks/js/lib/utils.js`

- [ ] **Step 1: 创建 hooks.json**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/enforcer.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: 创建 lib/utils.js**

从 stdin 读取 JSON，提供 output/log 工具函数。遵循现有 cpp-style-enforcer 的 `readStdinJson` 模式，但独立实现，不依赖外部 lib。

```js
'use strict';

function readStdinJson(opts = {}) {
  const { timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('stdin timeout')), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(null); });
    process.stdin.resume();
  });
}

function output(obj) {
  console.log(JSON.stringify(obj));
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

module.exports = { readStdinJson, output, log };
```

- [ ] **Step 3: 提交**

```bash
git add plugins/agent-dispatch/hooks/hooks.json plugins/agent-dispatch/hooks/js/lib/utils.js
git commit -m "feat(agent-dispatch): scaffold hooks.json + utils.js"
```

---

### Task 2: 默认规则配置

**Files:**
- Create: `plugins/agent-dispatch/defaults/dispatch-rules.json`
- Create: `plugins/agent-dispatch/hooks/js/lib/config.js`

- [ ] **Step 1: 创建 dispatch-rules.json**

```json
{
  "modules": {
    "enforcer": true,
    "prompt_inject": false
  },
  "whitelist": {
    "tools": [
      "Agent", "SendMessage",
      "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "TaskStop",
      "AskUserQuestion",
      "EnterPlanMode", "ExitPlanMode",
      "EnterWorktree", "ExitWorktree",
      "Skill", "Workflow",
      "CronCreate", "CronDelete", "CronList", "ScheduleWakeup",
      "Read", "Grep", "Glob", "LSP",
      "Edit", "Write", "MultiEdit", "NotebookEdit",
      "WebFetch", "WebSearch"
    ],
    "mcp_prefixes": [
      "mcp__plugin_context-mode_",
      "mcp__plugin_claude-mem_",
      "mcp__sequential-thinking"
    ],
    "bash_safe_heads": [
      "ls", "pwd", "cd", "mkdir", "rm", "mv", "cp", "touch",
      "cat", "echo", "which", "where",
      "fd", "rg", "grep", "jq", "delta", "gh", "tsc", "pyright", "pdftotext",
      "head", "tail", "wc", "sort", "uniq"
    ],
    "git_readonly": [
      ["status"], ["diff"], ["log"], ["show"], ["blame"], ["branch"],
      ["rev-parse"], ["rev-list"], ["ls-files"], ["ls-tree"],
      ["describe"], ["reflog"],
      ["remote", "-v"], ["remote", "show"],
      ["config", "--get"], ["config", "--list"],
      ["stash", "list"], ["stash", "show"],
      ["tag", "-l"], ["tag", "--list"]
    ],
    "git_safe_write": [
      "add", "commit", "push", "pull", "fetch", "tag",
      "switch", "checkout", "restore", "stash",
      "merge", "rebase", "reset", "cherry-pick", "revert",
      "rm", "mv", "clean", "worktree", "notes"
    ],
    "git_dangerous_patterns": [
      "push.*--force", "push.*-f\\b",
      "reset.*--hard",
      "branch.*-D\\b",
      "clean.*-f[dx]",
      "checkout.*--\\s+\\.",
      "restore.*--\\s+\\."
    ]
  },
  "overrides": {
    "tools_add": [],
    "tools_remove": [],
    "mcp_prefixes_add": [],
    "bash_heads_add": [],
    "bash_heads_remove": []
  }
}
```

- [ ] **Step 2: 创建 lib/config.js**

加载 defaults → 合并项目级 `.agent-dispatch.json`（若存在）。

```js
'use strict';
const fs = require('fs');
const path = require('path');

function loadDefaults() {
  const defaultsPath = path.resolve(__dirname, '..', '..', '..', 'defaults', 'dispatch-rules.json');
  return JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
}

function findProjectConfig() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.agent-dispatch.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function mergeConfig(defaults, overrides) {
  const result = JSON.parse(JSON.stringify(defaults));

  if (overrides.modules) {
    Object.assign(result.modules, overrides.modules);
  }

  const ov = overrides.overrides || {};
  if (ov.tools_add) result.whitelist.tools.push(...ov.tools_add);
  if (ov.tools_remove) {
    const rm = new Set(ov.tools_remove);
    result.whitelist.tools = result.whitelist.tools.filter((t) => !rm.has(t));
  }
  if (ov.mcp_prefixes_add) result.whitelist.mcp_prefixes.push(...ov.mcp_prefixes_add);
  if (ov.bash_heads_add) result.whitelist.bash_safe_heads.push(...ov.bash_heads_add);
  if (ov.bash_heads_remove) {
    const rm = new Set(ov.bash_heads_remove);
    result.whitelist.bash_safe_heads = result.whitelist.bash_safe_heads.filter((h) => !rm.has(h));
  }

  return result;
}

function loadConfig() {
  const defaults = loadDefaults();
  const projectPath = findProjectConfig();
  if (!projectPath) return defaults;
  try {
    const projectOverrides = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    return mergeConfig(defaults, projectOverrides);
  } catch {
    return defaults;
  }
}

module.exports = { loadConfig, loadDefaults, mergeConfig, findProjectConfig };
```

- [ ] **Step 3: 提交**

```bash
git add plugins/agent-dispatch/defaults/dispatch-rules.json plugins/agent-dispatch/hooks/js/lib/config.js
git commit -m "feat(agent-dispatch): default rules + config loader"
```

---

### Task 3: 规则匹配引擎 (rules.js)

**Files:**
- Create: `plugins/agent-dispatch/hooks/js/lib/rules.js`

- [ ] **Step 1: 实现 rules.js**

将现有 enforce 的 Bash 分析逻辑干净重写，拆分为独立可测试的函数。

```js
'use strict';

/**
 * ABOUTME: 规则匹配引擎 — 白名单检查 + Bash 命令安全分析
 * ABOUTME: 从 dispatch-rules.json 配置驱动，不硬编码规则
 */

function isWhitelistedTool(toolName, config) {
  return new Set(config.whitelist.tools).has(toolName);
}

function isWhitelistedMcp(toolName, config) {
  return config.whitelist.mcp_prefixes.some((p) => toolName.startsWith(p));
}

function hasCommandSubstitution(command) {
  return /\$\(|`/.test(command);
}

function tokenize(command) {
  if (typeof command !== 'string') return [];
  return command.trim().match(/(?:"[^"]*"|'[^']*'|\S+)/g) || [];
}

const SEPARATORS = new Set(['&&', '||', ';', '|']);

function splitSegments(tokens) {
  const segments = [[]];
  for (const tok of tokens) {
    if (SEPARATORS.has(tok)) segments.push([]);
    else segments[segments.length - 1].push(tok);
  }
  return segments.filter((s) => s.length > 0);
}

function isDangerousGit(gitArgs, config) {
  const joined = gitArgs.join(' ');
  return config.whitelist.git_dangerous_patterns.some((pat) => new RegExp(pat).test(joined));
}

function isReadonlyGit(gitArgs, config) {
  return config.whitelist.git_readonly.some((cmd) =>
    cmd.every((tok, i) => gitArgs[i] === tok)
  );
}

function isSafeGitWrite(gitArgs, config) {
  if (gitArgs.length === 0) return false;
  return config.whitelist.git_safe_write.includes(gitArgs[0]);
}

function classifySegment(tokens, config) {
  const cleaned = tokens.filter((t) => !['>', '>>', '<', '<<'].includes(t));
  if (cleaned.length === 0) return 'empty';
  const head = cleaned[0];

  if (head === 'git') {
    const gitArgs = cleaned.slice(1);
    if (gitArgs.length === 0) return 'unsafe';
    if (isDangerousGit(gitArgs, config)) return 'unsafe';
    if (isReadonlyGit(gitArgs, config)) return 'safe';
    if (isSafeGitWrite(gitArgs, config)) return 'safe';
    return 'unsafe';
  }

  return new Set(config.whitelist.bash_safe_heads).has(head) ? 'safe' : 'unsafe';
}

function isSafeBashCommand(command, config) {
  if (typeof command !== 'string' || !command.trim()) return false;
  if (hasCommandSubstitution(command)) return false;

  const tokens = tokenize(command);
  if (tokens.length === 0) return false;

  const segments = splitSegments(tokens);
  if (segments.length === 0) return false;

  return segments.every((seg) => classifySegment(seg, config) === 'safe');
}

module.exports = {
  isWhitelistedTool,
  isWhitelistedMcp,
  hasCommandSubstitution,
  tokenize,
  splitSegments,
  isDangerousGit,
  isReadonlyGit,
  isSafeGitWrite,
  classifySegment,
  isSafeBashCommand,
};
```

- [ ] **Step 2: 提交**

```bash
git add plugins/agent-dispatch/hooks/js/lib/rules.js
git commit -m "feat(agent-dispatch): rule matching engine"
```

---

### Task 4: enforcer.js 主钩子

**Files:**
- Create: `plugins/agent-dispatch/hooks/js/enforcer.js`

- [ ] **Step 1: 实现 enforcer.js**

```js
#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: PreToolUse Hook — 白名单制强制委派
 * ABOUTME: 非白名单工具 block，提示主 agent 用 Agent tool 委派子代理
 */

const { readStdinJson, output, log } = require('./lib/utils');
const { loadConfig } = require('./lib/config');
const { isWhitelistedTool, isWhitelistedMcp, isSafeBashCommand } = require('./lib/rules');

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    process.exit(0);
    return;
  }
  if (!input) { process.exit(0); return; }

  // 子代理 → 放行
  if (input.agent_id) { process.exit(0); return; }

  const config = loadConfig();
  if (!config.modules.enforcer) { process.exit(0); return; }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // 白名单工具 → 放行
  if (isWhitelistedTool(toolName, config)) { process.exit(0); return; }

  // MCP 前缀白名单 → 放行
  if (isWhitelistedMcp(toolName, config)) { process.exit(0); return; }

  // Bash/PowerShell → 分析命令
  if ((toolName === 'Bash' || toolName === 'PowerShell') && isSafeBashCommand(toolInput.command, config)) {
    process.exit(0);
    return;
  }

  // 拦截
  log(`[agent-dispatch] BLOCKED: ${toolName}`);
  output({
    decision: 'block',
    reason: `⚠ BLOCKED [${toolName}]. Delegate via Agent tool.\nAgent({ description: "...", prompt: "..." })`,
  });
  process.exit(0);
}

main();
```

- [ ] **Step 2: 提交**

```bash
git add plugins/agent-dispatch/hooks/js/enforcer.js
git commit -m "feat(agent-dispatch): enforcer hook"
```

---

### Task 5: prompt_inject.js（可选模块）

**Files:**
- Create: `plugins/agent-dispatch/hooks/js/prompt_inject.js`

- [ ] **Step 1: 实现 prompt_inject.js**

```js
#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 注入 dispatcher 角色指令（可选，默认关闭）
 */

const { loadConfig } = require('./lib/config');

function main() {
  const config = loadConfig();
  if (!config.modules.prompt_inject) return;

  const message = [
    '## Agent Dispatch Policy',
    '',
    'You are a DISPATCHER. Delegate actual work via Agent tool.',
    'You may directly: coordinate tasks, read files for dispatch decisions, make trivial edits.',
    'You must delegate: research, builds, analysis, multi-file changes, heavy MCP calls.',
  ].join('\n');

  console.log(message);
}

main();
```

- [ ] **Step 2: 在 hooks.json 中注册（默认关，config 控制）**

更新 `hooks.json`，追加 UserPromptSubmit 条目：

```json
{
  "hooks": {
    "PreToolUse": [ ... ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/prompt_inject.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add plugins/agent-dispatch/hooks/js/prompt_inject.js plugins/agent-dispatch/hooks/hooks.json
git commit -m "feat(agent-dispatch): optional prompt inject module"
```

---

### Task 6: Setup Skill

**Files:**
- Create: `plugins/agent-dispatch/commands/agent-dispatch-setup.md`

- [ ] **Step 1: 创建 setup skill**

```markdown
---
name: agent-dispatch-setup
description: 查看或配置 agent-dispatch：开关模块、调整白名单
---

## agent-dispatch 配置助手

你是 agent-dispatch 插件的配置助手。

### 查看当前配置

1. 读取插件默认规则 `${CLAUDE_PLUGIN_ROOT}/defaults/dispatch-rules.json`
2. 读取项目级覆盖（如果存在）：在项目根目录查找 `.agent-dispatch.json`
3. 展示合并后的有效配置，标注哪些是默认值、哪些被覆盖

### 修改配置

用户可能想要：
- **开关模块**：enforcer（默认开）/ prompt_inject（默认关）
- **添加白名单工具**：`overrides.tools_add`
- **移除白名单工具**：`overrides.tools_remove`
- **添加安全 Bash 命令**：`overrides.bash_heads_add`
- **添加 MCP 前缀**：`overrides.mcp_prefixes_add`

修改时：
1. 读取现有 `.agent-dispatch.json`（若不存在则从空对象开始）
2. 合并用户要求的变更
3. 写入 `.agent-dispatch.json` 到项目根目录
4. 展示变更前后的差异
```

- [ ] **Step 2: 提交**

```bash
git add plugins/agent-dispatch/commands/agent-dispatch-setup.md
git commit -m "feat(agent-dispatch): setup skill"
```

---

### Task 7: README + MANUAL_INSTALL

**Files:**
- Create: `plugins/agent-dispatch/README.md`
- Create: `plugins/agent-dispatch/docs/MANUAL_INSTALL.md`

- [ ] **Step 1: 创建 README.md**

README 需要覆盖：
1. 插件简介（一句话说明用途）
2. 工作原理（hook 时机 + 决策流程表）
3. 安装方式（插件命令安装）
4. 依赖（Node.js 18+，无其他）
5. 默认行为（白名单分类表：哪些放行、哪些拦截）
6. 配置（`.agent-dispatch.json` 格式 + 覆盖示例）
7. 模块开关说明
8. 与现有 subagent_enforce 钩子的迁移说明

README 使用中文撰写。技术术语（工具名、代码、JSON）保持英文。

- [ ] **Step 2: 创建 docs/MANUAL_INSTALL.md**

手动安装指南，参考 cpp-style-enforcer 的模式：
1. 前置条件（Node.js 18+）
2. 文件部署（cp 命令列表）
3. 在 settings.json 中注册钩子
4. 验证安装

- [ ] **Step 3: 提交**

```bash
git add plugins/agent-dispatch/README.md plugins/agent-dispatch/docs/MANUAL_INSTALL.md
git commit -m "docs(agent-dispatch): README + manual install guide"
```

---

### Task 8: 测试验证

- [ ] **Step 1: 手动测试矩阵**

在安装插件后，验证以下场景：

| 场景 | 输入 | 预期结果 |
|------|------|----------|
| 子代理调用任意工具 | `agent_id` 存在 | 放行 |
| 主 agent 调 Agent | `tool_name: "Agent"` | 放行 |
| 主 agent 调 Read | `tool_name: "Read"` | 放行 |
| 主 agent 调 `mcp__plugin_context-mode_*` | MCP 前缀匹配 | 放行 |
| 主 agent 调 `mcp__context7__query-docs` | 重型 MCP | **Block** |
| 主 agent 执行 `git status` | 安全 Bash | 放行 |
| 主 agent 执行 `git push --force` | 危险 git | **Block** |
| 主 agent 执行 `npm test` | 未知命令头 | **Block** |
| 主 agent 执行 `fd -t f .` | 安全 shell | 放行 |
| 主 agent 执行 `$(rm -rf /)` | 命令替换 | **Block** |
| enforcer 关闭 | `modules.enforcer: false` | 全部放行 |
| 项目覆盖添加 npm | `bash_heads_add: ["npm"]` | `npm test` 放行 |

- [ ] **Step 2: 运行验证**

启动新 Claude Code 会话，安装插件，依次触发上述场景，确认行为符合预期。

- [ ] **Step 3: 提交测试结果（如有修复）**

```bash
git add -A plugins/agent-dispatch/
git commit -m "fix(agent-dispatch): adjustments from manual testing"
```

---

### Task 9: marketplace 注册

- [ ] **Step 1: 更新 README.md 插件索引**

在仓库根 `README.md` 的插件索引表中添加 agent-dispatch 条目。

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: add agent-dispatch to plugin index"
```
