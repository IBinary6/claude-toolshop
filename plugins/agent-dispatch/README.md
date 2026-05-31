# agent-dispatch

白名单制强制主 agent 委派工作给子代理（subagent），保护主 agent 的 200K 上下文窗口。安装即生效，零配置。

## 工作原理

| Hook 时机 | 脚本 | 作用 |
|---|---|---|
| PreToolUse | `hooks/js/enforcer.js` | 白名单检查：非白名单工具 block，提示用 Agent tool 委派 |
| UserPromptSubmit | `hooks/js/prompt_inject.js` | 可选：注入 dispatcher 角色指令（默认**关闭**） |

### 决策流程

```
stdin → 解析 tool_name / tool_input / agent_id

1. agent_id 存在？        → 放行（子代理豁免）
2. tool 在白名单？        → 放行
3. tool 匹配 MCP 前缀？   → 放行
4. Bash/PowerShell？      → 分析命令内容：
   - 命令替换 $(...) → 拦截
   - 按 && || ; | 拆段，逐段判定：
     · git 只读        → 放行
     · git 安全写      → 放行（危险模式除外）
     · 安全 shell 头   → 放行
     · 其他            → 拦截
5. 其他                   → 拦截
```

拦截消息：
```
⚠ BLOCKED [toolName]. Delegate via Agent tool.
Agent({ description: "...", prompt: "..." })
```

## 安装

```
/plugin install IBinary6/claude-toolshop agent-dispatch
```

或手动部署，详见 [docs/MANUAL_INSTALL.md](./docs/MANUAL_INSTALL.md)。

## 依赖

| 依赖 | 必需 | 用途 |
|------|------|------|
| Node.js 18+ | **是** | hook 运行时 |

无外部 npm 包，纯 Node.js 标准库。

## 默认行为

### 放行（主 agent 可直接使用）

| 分类 | 工具 |
|------|------|
| 调度协调 | Agent, SendMessage, TaskCreate/Update/List/Get/Output/Stop, AskUserQuestion, Skill, Workflow |
| 模式切换 | EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree |
| 定时调度 | CronCreate, CronDelete, CronList, ScheduleWakeup |
| 轻量读取 | Read, Grep, Glob, LSP |
| 小幅编辑 | Edit, Write, MultiEdit, NotebookEdit |
| 网页查询 | WebFetch, WebSearch |

### MCP 前缀放行

| 前缀 | 理由 |
|------|------|
| `mcp__plugin_context-mode_` | 沙盒执行器，本身节省上下文 |
| `mcp__plugin_claude-mem_` | 记忆检索，已分层 |
| `mcp__sequential-thinking` | 思考链，输出短 |

### 安全 Bash 命令（放行）

```
ls, pwd, cd, mkdir, rm, mv, cp, touch, cat, echo, which, where,
fd, rg, grep, jq, delta, gh, tsc, pyright, pdftotext,
head, tail, wc, sort, uniq
```

Git 只读命令（status, diff, log, show, blame 等）和安全写命令（add, commit, push 等）也放行。

### 拦截

- 重型 MCP 工具（context7, microsoft-learn, deepwiki, tavily, serena, exa 等）
- 未知 Bash 命令头
- 危险 git 操作（push --force, reset --hard, branch -D, clean -fdx, checkout -- ., restore -- .）
- 含命令替换 `$(...)` 或反引号的 Bash

## 配置

### 零配置即可工作

安装后使用内置默认规则，无需任何配置文件。

### 项目级覆盖（可选）

在项目根目录创建 `.agent-dispatch.json`，只写想改的部分：

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
    "bash_heads_add": ["cargo", "npm", "pnpm"],
    "bash_heads_remove": ["rm"]
  }
}
```

合并逻辑：
```
final_tools      = (默认 + tools_add) - tools_remove
final_mcp        = 默认 + mcp_prefixes_add
final_bash_heads = (默认 + bash_heads_add) - bash_heads_remove
```

也可使用 `/agent-dispatch-setup` skill 交互式配置。

## 模块说明

| 模块 | 默认 | 作用 |
|------|------|------|
| enforcer | **开启** | PreToolUse 白名单拦截 |
| prompt_inject | 关闭 | UserPromptSubmit 注入 dispatcher 指令 |

在 `.agent-dispatch.json` 中设置 `modules.enforcer: false` 可临时关闭拦截。

## 从全局 subagent_enforce 迁移

如果你之前在 `~/.claude/settings.json` 中注册了全局 `subagent_enforce` 钩子：

1. 安装本插件
2. 从 `~/.claude/settings.json` 的 `hooks.PreToolUse` 数组中移除 `subagent_enforce` 条目
3. 如有 `subagent_prompt` 的 UserPromptSubmit 条目，也一并移除
4. 本插件完全替代上述两个钩子的功能

## 协议安全

- 全程 `exit 0`——永不 exit 1/2，不阻塞会话
- stdout 要么空（放行）、要么单条 JSON（block）
- 诊断信息写 stderr
- 畸形 stdin（空、非 JSON、缺字段）静默 exit 0

## 协议

MIT
