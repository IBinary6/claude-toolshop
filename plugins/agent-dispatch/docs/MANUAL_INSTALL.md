# agent-dispatch 手动安装指南

本指南适用于不使用 `/plugin` 命令的用户。手动将 hook 文件部署到 `~/.claude/` 并在 `settings.json` 注册。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` 环境变量不可用，脚本内部使用 `__dirname` 相对定位，因此**只要保持目录层级一致**即可正常工作。

## 一、前置条件

| 依赖 | 最低版本 | 必需 | 用途 |
|------|---------|------|------|
| Node.js | 18+ | **是** | hook 运行时 |

验证：

```bash
node --version   # >= v18
```

## 二、文件部署

将本仓库 `plugins/agent-dispatch/` 下的文件拷贝到 `~/.claude/` 对应位置，**保持目录层级**。

```bash
REPO="/path/to/claude-toolshop/plugins/agent-dispatch"
DEST="$HOME/.claude/plugins-manual/agent-dispatch"

mkdir -p "$DEST/hooks/js/lib" \
         "$DEST/defaults" \
         "$DEST/commands"

# 核心文件
cp "$REPO/hooks/hooks.json"                "$DEST/hooks/"
cp "$REPO/hooks/js/enforcer.js"            "$DEST/hooks/js/"
cp "$REPO/hooks/js/prompt_inject.js"       "$DEST/hooks/js/"
cp "$REPO/hooks/js/lib/utils.js"           "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/config.js"          "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/rules.js"           "$DEST/hooks/js/lib/"

# 默认规则
cp "$REPO/defaults/dispatch-rules.json"    "$DEST/defaults/"

# Skill（可选）
cp "$REPO/commands/agent-dispatch-setup.md" "$DEST/commands/"
```

## 三、在 settings.json 中注册钩子

编辑 `~/.claude/settings.json`，在 `hooks` 对象中添加：

```json
{
  "hooks": {
    "PreToolUse": [
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

> Windows 用户将 `$HOME` 替换为实际路径（如 `C:/Users/username`），使用正斜杠。

## 四、验证安装

启动新 Claude Code 会话，尝试让主 agent 调用一个不在白名单内的工具（如重型 MCP）。预期行为：

```
⚠ BLOCKED [mcp__context7__query-docs]. Delegate via Agent tool.
Agent({ description: "...", prompt: "..." })
```

如果看到上述 block 消息，说明安装成功。

## 五、卸载

1. 删除 `~/.claude/plugins-manual/agent-dispatch/` 目录
2. 从 `~/.claude/settings.json` 中移除对应的 hook 条目
