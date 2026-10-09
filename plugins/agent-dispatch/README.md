# agent-dispatch

面向 Claude Code 原生 `Agent` 与 Hook 生命周期的任务调度插件。它保护主 Agent 的上下文，但不会机械复制 Codex 的工具名、模型名或来源识别方式。

## 语义边界

两端共享的是职责，而不是实现：

- 主 Agent 负责需求澄清、关键方案与公开契约决策、拆分、结果审查、最终整合和全部 Git 操作。
- 子代理负责边界明确的调查、规划分析、交付执行、验证或独立审查；不得继续派遣，不得运行 Git。
- 路由提示是基于当前消息的**候选建议**，不是宿主限制或跨轮约束；主 Agent 按完整对话与用户最新明确要求判断。
- 只读线索只从请求分句开头识别（“只读诊断”“不要修改”），产品行为里的“不修改/只读模式”不会把实现任务误判为只读。
- CodeMap 插件负责图刷新和读前屏障；Agent Dispatch 只负责选择角色。
- 委派不会扩大文件、权限、网络或外部状态范围。

Claude Code 可以在 `SubagentStart` 注入约束，并在 `SubagentStop` 检查最终报告；这两项能力直接用于本插件，而不是仿照 Codex 的 hook payload。

## 原生 Agent 角色

插件安装后，角色使用 `agent-dispatch:<name>` 调用：

| 角色 | 模型 / effort | 用途 |
|---|---|---|
| `dispatch-explorer` | haiku / medium | 有界跨文件搜索、代码取证和材料摘录 |
| `dispatch-mapper` | haiku / medium | 广泛、跨模块、只读扫描 |
| `dispatch-researcher` | haiku / medium | 官方/公开来源的外部研究，回传来源与日期 |
| `dispatch-tester` | haiku / high | 按既定用例运行测试、复现步骤和日志取证，不改被验收代码 |
| `dispatch-planner` | opus / high | 非琐碎计划、架构和接口契约；已有可执行方案时不用 |
| `dispatch-worker` | sonnet / high | 代码写作（含写测试）与常规交付执行 |
| `dispatch-hard-worker` | sonnet / xhigh | 困难实现或复杂调试（仍是写代码，用 sonnet 并提高 effort） |
| `dispatch-reviewer` | opus / high | 常规与高风险的默认独立审查 |
| `dispatch-deep-reviewer` | opus / xhigh | 关键验收或极复杂约束需要更高推理强度时才用 |

**分工规则**：opus 负责**规划与审查**；sonnet 负责**写代码**（困难实现只提高 effort，不换模型）；其余——读代码、搜索扫描、读日志、外部研究、既定测试执行——一律 **haiku**。风险或审查关键词本身不决定换模型，混合任务只把证据阶段交给 haiku。审查默认排除 `3rd`、`third_party`、`thridpart`、`vendor` 等第三方实现目录，只核对自有代码接入。sonnet 不支持的 effort 档位会由 Claude Code 自动回落到其支持的最高档。

只读角色通过 `disallowedTools` 禁止编辑和继续派遣（tester 保留 Shell 以运行测试）；写入角色禁止继续派遣，并由 Hook 额外阻止子代理 Git。CodeMap MCP schema 延迟加载时角色先用 `ToolSearch` 发现工具（Haiku 4.5 及以后支持 tool search）。

## Hook 生命周期

| Hook | 脚本 | 作用 |
|---|---|---|
| `SessionStart` | `session_start.js` | 创建/升级配置，并向主 Agent 注入稳定职责边界 |
| `UserPromptSubmit` | `prompt_inject.js` | 按任务语义给出候选角色；用户限定主 Agent、精确小范围、策略讨论和纯 Git CLI 保持静默；block marker 只补充失败恢复 |
| `PreToolUse:Agent` | `agent_nudge.js` | 使用泛化 agent 时提示更合适的插件 scoped agent |
| `PreToolUse` | `enforcer.js` | 子代理 Git 强制拦截（默认开启）；主 Agent 工具硬门禁默认关闭，可在配置中开启 |
| `SubagentStart` | `subagent_start.js` | 注入范围、CodeMap、Git 和报告约束 |
| `SubagentStop` | `subagent_stop.js` | 缺少报告小节时阻止一次结束；`stop_hook_active` 时放行，避免循环 |

任务路由先提取范围线索（只读、只用主 Agent、代理数量限制、已有方案、单文件），再判断意图：审查、非琐碎计划、低成本证据、验证、外部研究、只读调查、高风险修改（主 Agent 先核对契约与授权）、困难任务（明确要求方案时才先规划）、常规实现、交付执行；琐碎改动留给主 Agent。

## Git 与工具门禁

主 Agent 的 Git 命令全部放行，因为 Git 串行操作本来就是主 Agent 职责；破坏性 Git 的授权和确认由 Claude Code 权限层及用户要求负责。任何带 `agent_id` 的子代理 Bash/PowerShell 事件只要实际执行 Git（包括复合命令、包装器和绝对路径）都会被拦截。

开启 `modules.enforcer` 后，主 Agent 仍可直接使用的白名单：

- `Agent`、`ToolSearch`、Team/Task/Todo、询问和模式切换工具；
- Read/Grep/Glob/LSP、Edit/Write/MultiEdit/NotebookEdit；
- WebFetch/WebSearch；
- context-mode、claude-mem、sequential-thinking、CodeMap 和 Serena 等配置的 MCP 前缀；
- 规则中列出的安全 Shell 命令头。

主 Agent 工具硬门禁默认关闭（`modules.enforcer: false`）：单次工具调用不足以判断任务是否该委派，路由由 SessionStart / UserPromptSubmit 负责。需要强制上下文保护时可开启；开启后未知或重型工具会被拦截并提示派遣子任务。该门禁是上下文保护，不是安全沙箱。子代理 Git 拦截由独立的 `modules.subagent_git_guard` 控制。

## 安装

```text
/plugin install agent-dispatch@claude-toolshop
```

手动部署见 [docs/MANUAL_INSTALL.md](./docs/MANUAL_INSTALL.md)。依赖 Node.js 18+，无第三方运行时包。

## 配置

SessionStart 自动维护：

- 全局：`~/.agent-dispatch/config.json`
- 项目：`<git_root>/.agent-dispatch/config.json`

配置按“插件默认值 → 全局 → 项目”合并。Schema v3 支持模块、策略和增删量覆盖：

```json
{
  "schema_version": 3,
  "modules": {
    "enforcer": false,
    "subagent_git_guard": true,
    "prompt_inject": true,
    "session_guidance": true,
    "subagent_guidance": true,
    "subagent_report_guard": true
  },
  "policy": {
    "max_parallel_subagents": 3,
    "require_changed_file_report": true,
    "require_validation_report": true,
    "require_blocker_report": true
  },
  "overrides": {
    "tools_add": [],
    "tools_remove": [],
    "mcp_prefixes_add": [],
    "mcp_prefixes_remove": [],
    "mcp_block_exact_add": [],
    "mcp_block_exact_remove": [],
    "bash_heads_add": [],
    "bash_heads_remove": [],
    "prompt_keywords_add": [],
    "prompt_keywords_remove": []
  }
}
```

旧版项目根 `.agent-dispatch.json` 继续兼容。配置文件存在时只升级缺失结构，不覆盖用户已有值。也可使用 `/agent-dispatch-setup` 查看或修改增量配置。

## 验证

```bash
npm test
claude plugin validate --strict .
```

Hook 放行时 stdout 为空；需要注入或 block 时只输出一条协议 JSON；诊断写 stderr，畸形 stdin 静默退出。

## 协议

MIT
