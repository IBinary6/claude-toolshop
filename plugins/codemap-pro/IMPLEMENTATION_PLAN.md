# codemap-pro 当前实现说明

`codemap-pro` 基于 CodeGraph 维护项目代码图谱，并通过运行时 hook 引导 Claude 优先使用图谱 MCP。当前版本不再向 `CLAUDE.md` / `AGENTS.md` 写入持久提示词，避免长期占用上下文。

## 目标

- SessionStart 时后台初始化 `.codegraph/codegraph.db`。
- PostToolUse 时用 `codegraph sync` 做兜底增量同步。
- EnterWorktree 时为 worktree 独立初始化或同步图谱。
- PreToolUse:Grep / Agent 时提供短运行时提示，引导使用 CodeGraph MCP。
- 与 `codemap-boost` 建议二选一，避免重复 hook 和重复运行时提示。

## Hook

| 时机 | 脚本 | 作用 |
|---|---|---|
| SessionStart | `hooks/js/cg_init/cg_init.js` | 检测并后台初始化 CodeGraph |
| SessionStart | `hooks/js/cg_gitignore/cg_gitignore.js` | 将图谱输出目录写入 `.gitignore` |
| PreToolUse:Grep | `hooks/js/grep_nudge/grep_nudge.js` | 运行时提示优先使用图谱 |
| PreToolUse:Agent | `hooks/js/agent_nudge/agent_nudge.js` | 子代理任务中加入短图谱提示 |
| PostToolUse | `hooks/js/cg_update/cg_update.js` | 编辑后增量更新 |
| EnterWorktree | `hooks/js/cg_worktree/cg_worktree.js` | worktree 图谱初始化/同步 |

`hooks/js/claudemd_inject/claudemd_inject.js` 仅保留为旧安装兼容脚本：清理历史标记片段并预热依赖，不再追加任何内容。

## Token 策略

图谱本身比持久提示更省 token。运行时提示只在 Grep / Agent 触发时出现，并保持短文本。建议每个任务最多 3 次图谱工具调用，除非确实是大规模重构评审等需要更深分析的场景。
