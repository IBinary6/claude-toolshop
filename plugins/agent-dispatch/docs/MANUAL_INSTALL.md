# agent-dispatch 手动安装指南

优先使用 `/plugin install agent-dispatch@claude-toolshop`。只有不能使用插件系统时，才按本指南分别部署 Hook、Agent 和命令。

## 前置条件

- Claude Code 支持 `Agent`、`SubagentStart`、`SubagentStop` 与 `ToolSearch`
- Node.js 18+

```bash
node --version
claude --version
```

## 部署文件

```bash
REPO="/path/to/claude-toolshop/plugins/agent-dispatch"
DEST="$HOME/.claude/plugins-manual/agent-dispatch"

mkdir -p "$DEST/hooks/js/lib" \
         "$DEST/hooks/js/agent_nudge" \
         "$DEST/defaults" \
         "$HOME/.claude/agents" \
         "$HOME/.claude/commands"

cp "$REPO/hooks/js/session_start.js"             "$DEST/hooks/js/"
cp "$REPO/hooks/js/enforcer.js"                  "$DEST/hooks/js/"
cp "$REPO/hooks/js/prompt_inject.js"             "$DEST/hooks/js/"
cp "$REPO/hooks/js/subagent_start.js"            "$DEST/hooks/js/"
cp "$REPO/hooks/js/subagent_stop.js"             "$DEST/hooks/js/"
cp "$REPO/hooks/js/agent_nudge/agent_nudge.js"   "$DEST/hooks/js/agent_nudge/"
cp "$REPO/hooks/js/lib/utils.js"                 "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/config.js"                "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/rules.js"                 "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/marker.js"                "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/guidance.js"              "$DEST/hooks/js/lib/"
cp "$REPO/defaults/dispatch-rules.json"          "$DEST/defaults/"

cp "$REPO"/agents/*.md                           "$HOME/.claude/agents/"
cp "$REPO/commands/agent-dispatch-setup.md"      "$HOME/.claude/commands/"
```

插件安装时 Agent 名称带 `agent-dispatch:` 前缀；手动复制到 `~/.claude/agents` 后名称是 `dispatch-worker` 等不带前缀的名字。Hook 提示中的两种名称指向同一角色语义。

## 注册 Hook

把下列条目合并到 `~/.claude/settings.json` 的 `hooks` 对象，不要覆盖其他 Hook：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/session_start.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/subagent_start.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/subagent_stop.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/agent_nudge/agent_nudge.js\"",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/enforcer.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins-manual/agent-dispatch/hooks/js/prompt_inject.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Windows 中建议把 `$HOME` 替换为 `C:/Users/<name>` 形式的绝对路径。

## 验证

1. 启动新 Claude Code 会话，确认出现主 Agent 调度上下文。
2. 请求“实现一个边界清晰的功能”，确认路由提示推荐 `dispatch-worker`。
3. 启动该 Agent，确认其最终报告包含 `Changed files:`、`Validation:`、`Blockers:`。
4. 让子代理尝试执行 `git status`，应被 Hook 拦截；主 Agent 的同一命令应放行。

## 卸载

1. 从 `~/.claude/settings.json` 删除上述 Hook 条目。
2. 删除 `~/.claude/plugins-manual/agent-dispatch/`。
3. 删除本插件复制到 `~/.claude/agents/` 的七个 `dispatch-*.md` 和 `~/.claude/commands/agent-dispatch-setup.md`。
