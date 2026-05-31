# agent-dispatch — 插件设计文档

## 概述

Claude Code 插件，强制主 agent 将工作委派给子代理（subagent），保护主 agent 的上下文窗口。用干净、可维护、可配置的插件架构替代原有的 `subagent_enforce` / `subagent_prompt` 全局钩子。

## 问题

- 每次手动告诉 Claude Code "请用 subagent" 很繁琐
- 现有 enforce 钩子经过反复增删改，代码已无法维护
- 不做强制约束时，主 agent 会在本可交给子代理的工作上消耗上下文

## 核心原则

**白名单制**：只有明确放行的工具/命令允许主 agent 直接使用，其余一律 block 并提示委派。子代理调用（携带 `agent_id`）无条件豁免。

## 插件结构

```
plugins/agent-dispatch/
├── README.md
├── commands/
│   └── agent-dispatch-setup.md      # 可选的 setup skill
├── hooks/
│   ├── hooks.json                   # 钩子注册
│   └── js/
│       ├── lib/
│       │   ├── utils.js             # readStdinJson / output / log
│       │   ├── rules.js             # 规则匹配引擎
│       │   └── config.js            # 配置加载与合并
│       └── enforcer.js              # PreToolUse — 主执行钩子
├── defaults/
│   └── dispatch-rules.json          # 内置默认规则
└── docs/
    └── MANUAL_INSTALL.md
```

## 模块

| 模块 | 钩子 | Matcher | 默认状态 | 职责 |
|------|------|---------|----------|------|
| Enforcer | PreToolUse | `Bash\|PowerShell\|Write\|Edit\|MultiEdit\|NotebookEdit\|WebFetch\|WebSearch\|mcp__.*` | 开启 | 白名单制工具拦截，强制委派 |
| Prompt Inject | UserPromptSubmit | — | 关闭 | 注入固定的"你是调度器"指令 |

插件安装即生效，零配置。Setup skill 仅供需要自定义规则的用户使用。

## Enforcer 决策流程

```
stdin JSON → 解析 tool_name, tool_input, agent_id

1. agent_id 存在？              → 放行（子代理豁免）
2. tool 在白名单中？            → 放行
3. tool 匹配 MCP 前缀白名单？   → 放行
4. tool 是 Bash/PowerShell？    → 分析命令内容：
   a. 含命令替换？              → 拦截
   b. 按 && || ; | 拆分，逐段检查：
      - git 只读命令？          → 放行
      - git 安全写命令？        → 检查非危险操作 → 放行
      - 安全 shell 命令头？     → 放行
      - 其他                    → 拦截
5. 其他                         → 拦截
```

## Block 消息格式

```
⚠ BLOCKED [toolName]. Delegate via Agent tool.
Agent({ description: "...", prompt: "..." })
```

两行。由 AI 消费，非面向用户。

## 工具分类

### 白名单工具（主 agent 可直接使用）

| 分类 | 工具 | 理由 |
|------|------|------|
| 调度协调 | Agent, SendMessage, TaskCreate/Update/List/Get/Output/Stop, AskUserQuestion, Skill, Workflow | 主 agent 的本职工作 |
| 模式切换 | EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree | 会话控制 |
| 定时调度 | CronCreate, CronDelete, CronList, ScheduleWakeup | 轻量元操作 |
| 轻量读取 | Read, Grep, Glob, LSP | 主 agent 需要读取信息以做出调度决策 |
| 小幅编辑 | Edit, Write, MultiEdit, NotebookEdit | 单文件小改动不值得起子代理 |
| 网页查询 | WebFetch, WebSearch | 结果需主 agent 直接消费 |

### MCP 前缀白名单

| 前缀 | 理由 |
|------|------|
| `mcp__plugin_context-mode_` | 沙盒执行器，本身就是节省上下文的设计 |
| `mcp__plugin_claude-mem_` | 记忆检索，已分层（index → 取详情） |
| `mcp__sequential-thinking` | 思考链，输出短 |

### 拦截（其余所有）

- 重型 MCP 工具（context7, microsoft-learn, deepwiki, tavily, serena, exa 等）
- 不在白名单中的未知工具

### Bash 命令分析

**安全 shell 命令头**（放行）：
```
ls, pwd, cd, mkdir, rm, mv, cp, touch,
cat, echo, which, where,
fd, rg, grep, jq, delta, gh, tsc, pyright, pdftotext,
head, tail, wc, sort, uniq
```

**Git 只读命令**（放行）：
```
status, diff, log, show, blame, branch,
rev-parse, rev-list, ls-files, ls-tree,
describe, reflog, remote -v/show, config --get/--list,
stash list/show, tag -l/--list
```

**Git 安全写命令**（放行，除非为危险操作）：
```
add, commit, push, pull, fetch, tag,
switch, checkout, restore, stash,
merge, rebase, reset, cherry-pick, revert,
rm, mv, clean, worktree, notes
```

**Git 危险模式**（拦截）：
```
push --force / push -f
reset --hard
branch -D
clean -f[dx]
checkout -- .
restore -- .
```

**命令替换**（`$(...)` 或反引号）：始终拦截。

**管道/链式命令段**：按 `&&`、`||`、`;`、`|` 拆分——每一段必须独立通过检查。

## 配置

### 加载优先级

```
插件内置默认 (defaults/dispatch-rules.json)
       ↓ 合并覆盖
项目级 .agent-dispatch.json（可选，位于项目根目录）
```

无需配置文件——内置默认即可直接使用。

### 覆盖格式 (.agent-dispatch.json)

用户只需写增量覆盖，未指定的字段保持默认值。

```json
{
  "modules": {
    "enforcer": true,
    "prompt_inject": false
  },
  "overrides": {
    "tools_add": ["SomeCustomTool"],
    "tools_remove": ["WebSearch"],
    "mcp_prefixes_add": ["mcp__my_custom_"],
    "bash_heads_add": ["cargo", "npm"],
    "bash_heads_remove": ["rm"]
  }
}
```

### 配置合并逻辑

```
final_tools      = (default_tools + tools_add) - tools_remove
final_mcp        = (default_mcp + mcp_prefixes_add)
final_bash_heads = (default_bash_heads + bash_heads_add) - bash_heads_remove
```

## Setup Skill

`commands/agent-dispatch-setup.md` — 交互式配置助手。插件正常工作**不需要**此 skill。适用场景：

- 查看当前生效的规则
- 开关 enforcer / prompt_inject 模块
- 添加/移除白名单条目
- 在项目根目录生成 `.agent-dispatch.json`

## Prompt Inject 模块（可选，默认关闭）

开启后在 UserPromptSubmit 注入一段固定英文指令，告知主 agent 它是调度器。固定文本，不分析用户 prompt，token 开销极小。

## 依赖

- Node.js 18+
- 无外部包（纯 Node.js 标准库）
- 不依赖特定 subagent_type——适用于任何 Claude Code 安装环境

## 非目标

- 不做面向特定 agent 类型的智能路由（用户环境各异）
- 不做模型分级路由（留待未来版本）
- 不做会话状态跟踪
- 不做 PostToolUse 钩子
