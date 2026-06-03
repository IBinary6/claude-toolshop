# agent-dispatch

白名单制强制主 agent 委派工作给子代理（subagent），保护主 agent 的 200K 上下文窗口。安装即生效，零配置。

## 工作原理

| Hook 时机 | 脚本 | 作用 |
|---|---|---|
| SessionStart | `hooks/js/session_start.js` | 自动创建全局/项目配置骨架，并把项目 `.agent-dispatch/` 加入 `.gitignore` |
| PreToolUse | `hooks/js/enforcer.js` | 白名单检查：非白名单工具 block，提示用 Agent tool 委派 |
| UserPromptSubmit | `hooks/js/prompt_inject.js` | 可选：被 block 后的下一条 prompt 注入一次 dispatcher 角色指令（默认**开启**） |

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
| `mcp__code_review_graph__` / `mcp__code-review-graph__` | 代码图谱审查工具，主 agent 可直接查询上下文 |
| `mcp__codegraph__` / `mcp__graphify__` | 绘图/图谱类工具，主 agent 可直接查询和更新 |

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

SessionStart 会自动创建两层可编辑配置：

| 层级 | 路径 | 作用 |
|---|---|---|
| 全局配置 | `~/.agent-dispatch/config.json` | 对所有项目生效，适合放个人常用白名单/黑名单 |
| 项目配置 | `<git_root>/.agent-dispatch/config.json` | 覆盖全局配置，只对当前仓库生效 |

项目配置目录 `.agent-dispatch/` 会在运行时自动加入当前仓库 `.gitignore`。默认不提交；如需团队共享，把 `.gitignore` 中的 `.agent-dispatch/` 删除即可。

### 黑白名单过滤

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
    "mcp_prefixes_remove": ["mcp__sequential-thinking"],
    "mcp_block_exact_add": ["mcp__my_custom__dangerous_write"],
    "mcp_block_exact_remove": ["mcp__plugin_context-mode_context-mode__ctx_execute"],
    "bash_heads_add": ["cargo", "npm", "pnpm"],
    "bash_heads_remove": ["rm"]
  }
}
```

合并逻辑：
```
final_tools      = (默认 + tools_add) - tools_remove
final_mcp        = (默认 + mcp_prefixes_add) - mcp_prefixes_remove
final_mcp_block  = (默认 + mcp_block_exact_add) - mcp_block_exact_remove
final_bash_heads = (默认 + bash_heads_add) - bash_heads_remove
```

所有列表会去重。修改 `~/.agent-dispatch/config.json` 后，下次 hook 运行会重新读取并合并，不需要改插件内置 `defaults/dispatch-rules.json`。这样自动同步 JSON 配置时只需要写增删量过滤规则，而不是复制整份默认配置。

旧版项目根 `.agent-dispatch.json` 仍兼容；SessionStart 会在新项目优先创建 `<git_root>/.agent-dispatch/config.json`。

也可使用 `/agent-dispatch-setup` skill 交互式配置。

## 模块说明

| 模块 | 默认 | 作用 |
|------|------|------|
| enforcer | **开启** | PreToolUse 白名单拦截 |
| prompt_inject | **开启** | UserPromptSubmit 注入 dispatcher 指令（被 block 后下一条 prompt 注入一次） |

在全局或项目 `config.json` 中设置 `modules.enforcer: false` 可临时关闭拦截。

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
