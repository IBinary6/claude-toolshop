# agent-dispatch

面向 Claude Code 原生 `Agent` 与 Hook 生命周期的任务调度插件。它保护主 Agent 的上下文，但不会机械复制 Codex 的工具名、模型名或来源识别方式。

## 语义边界

两端共享的是职责，而不是实现：

- 主 Agent 负责需求澄清、架构/接口决策、拆分、结果审查、最终整合和全部 Git 操作。
- 子代理负责边界明确的搜索、实现或独立审查；不得继续派遣，不得运行 Git。
- CodeMap 插件负责图刷新和读前屏障；Agent Dispatch 只负责选择角色。
- 委派不会扩大文件、权限、网络或外部状态范围。

Claude Code 可以在 `SubagentStart` 注入约束，并在 `SubagentStop` 检查最终报告；这两项能力直接用于本插件，而不是仿照 Codex 的 hook payload。

## 原生 Agent 角色

插件安装后，角色使用 `agent-dispatch:<name>` 调用：

| 角色 | 模型 / effort | 用途 |
|---|---|---|
| `dispatch-explorer` | sonnet / low | 有界跨文件搜索和证据收集 |
| `dispatch-mapper` | sonnet / medium | 广泛、跨模块、只读扫描 |
| `dispatch-planner` | opus / xhigh | 非琐碎计划、架构和接口契约 |
| `dispatch-worker` | sonnet / high | 边界清晰的常规实现 |
| `dispatch-hard-worker` | opus / max | 已有审定计划的困难实现 |
| `dispatch-reviewer` | sonnet / high | 常规独立审查 |
| `dispatch-deep-reviewer` | opus / xhigh | 安全、权限、并发等高风险审查 |

只读角色通过 `disallowedTools` 禁止编辑、Shell 和继续派遣；写入角色禁止继续派遣，并由 Hook 额外阻止子代理 Git。CodeMap MCP schema 延迟加载时，角色会先使用 `ToolSearch`，因此没有使用不支持 tool search 的 Haiku。

## Hook 生命周期

| Hook | 脚本 | 作用 |
|---|---|---|
| `SessionStart` | `session_start.js` | 创建/升级配置，并向主 Agent 注入稳定职责边界 |
| `UserPromptSubmit` | `prompt_inject.js` | 按任务语义推荐最低可靠角色；block marker 只补充失败恢复 |
| `PreToolUse:Agent` | `agent_nudge.js` | 使用泛化 agent 时提示更合适的插件 scoped agent |
| `PreToolUse` | `enforcer.js` | 主 Agent 重型工具门禁；子代理普通工具豁免、Git 强制拦截 |
| `SubagentStart` | `subagent_start.js` | 注入范围、CodeMap、Git 和报告约束 |
| `SubagentStop` | `subagent_stop.js` | 缺少报告小节时阻止一次结束；`stop_hook_active` 时放行，避免循环 |

任务路由按风险优先：高风险审查、困难任务两阶段、非琐碎计划、广泛扫描、有界搜索、常规实现、常规审查；琐碎改动留给主 Agent。

## Git 与工具门禁

主 Agent 的 Git 命令全部放行，因为 Git 串行操作本来就是主 Agent 职责；破坏性 Git 的授权和确认由 Claude Code 权限层及用户要求负责。任何带 `agent_id` 的子代理 Bash/PowerShell 事件只要实际执行 Git（包括复合命令、包装器和绝对路径）都会被拦截。

主 Agent 默认可以直接使用：

- `Agent`、`ToolSearch`、Team/Task/Todo、询问和模式切换工具；
- Read/Grep/Glob/LSP、Edit/Write/MultiEdit/NotebookEdit；
- WebFetch/WebSearch；
- context-mode、claude-mem、sequential-thinking、CodeMap 和 Serena 等配置的 MCP 前缀；
- 规则中列出的安全 Shell 命令头。

未知或重型工具仍会触发硬门禁，提示主 Agent 派遣有界子任务。该门禁是上下文保护，不是安全沙箱。

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
    "enforcer": true,
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
