# codemap-boost 手动安装指南

本指南适用于不使用 `/plugin` 命令的用户。手动将 hook 文件部署到 `~/.claude/` 并在 `settings.json` 注册。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` 环境变量不可用，所有路径均使用展开后的实际路径。

---

## 一、前置条件

| 依赖 | 最低版本 | 必需 | 用途 |
|------|---------|------|------|
| Node.js | 18+ | **是** | hook 运行时 |
| Python | 3.10+ | 推荐 | pip 自举缺失 CLI；CRG / graphify 本身依赖 Python |
| code-review-graph CLI | — | 可选但推荐 | CRG 图谱构建/更新 |
| graphify CLI | — | 可选但推荐 | graphify 图谱构建（pip 包名 `graphifyy`，提供 `graphify` 命令） |

验证：

```bash
node --version              # >= v18
python --version            # >= 3.10（pip 自举需要）
code-review-graph --version # 可选
graphify --version          # 可选
```

CRG / graphify 装哪个就启用哪个，**不装也不报错**——hook 内部 `commandExists` 静默降级。装上 Python + pip 后，SessionStart 会后台尝试 `pip install code-review-graph` / `pip install graphifyy` 自举缺失项；装不上则降级跳过，安装只尝试一次。后台自举不会自动注册 MCP；如需 MCP 工具，请显式运行 `code-review-graph install --platform claude-code --no-skills --no-hooks --no-instructions --yes`。

---

## 二、文件部署

将本仓库 `plugins/codemap-boost/` 下的文件拷贝到 `~/.claude/` 对应位置。

| 源（本仓库 `plugins/codemap-boost/`） | 目标 |
|---|---|
| `hooks/js/crg_build/crg_build.js` | `~/.claude/hooks/js/crg_build/crg_build.js` |
| `hooks/js/crg_update/crg_update.js` | `~/.claude/hooks/js/crg_update/crg_update.js` |
| `hooks/js/graphify_build/graphify_build.js` | `~/.claude/hooks/js/graphify_build/graphify_build.js` |
| `hooks/js/grep_nudge/grep_nudge.js` | `~/.claude/hooks/js/grep_nudge/grep_nudge.js` |
| `hooks/js/lib/utils.js` | `~/.claude/hooks/js/lib/utils.js` |
| `hooks/js/lib/ensure_deps.js` | `~/.claude/hooks/js/lib/ensure_deps.js` |
| `commands/codemap-boost-setup.md` | `~/.claude/commands/codemap-boost-setup.md` |

参考命令（Bash）：

```bash
REPO="/path/to/claude-toolshop/plugins/codemap-boost"
DEST="$HOME/.claude"

# hooks
mkdir -p "$DEST/hooks/js/crg_build" \
         "$DEST/hooks/js/crg_update" "$DEST/hooks/js/graphify_build" \
         "$DEST/hooks/js/grep_nudge" "$DEST/hooks/js/lib"
cp "$REPO/hooks/js/crg_build/crg_build.js"             "$DEST/hooks/js/crg_build/"
cp "$REPO/hooks/js/crg_update/crg_update.js"           "$DEST/hooks/js/crg_update/"
cp "$REPO/hooks/js/graphify_build/graphify_build.js"   "$DEST/hooks/js/graphify_build/"
cp "$REPO/hooks/js/grep_nudge/grep_nudge.js"           "$DEST/hooks/js/grep_nudge/"
cp "$REPO/hooks/js/lib/utils.js"                       "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/lib/ensure_deps.js"                 "$DEST/hooks/js/lib/"

# 命令
mkdir -p "$DEST/commands"
cp "$REPO/commands/codemap-boost-setup.md" "$DEST/commands/"
```

---

## 三、settings.json Hook 注册

在 `~/.claude/settings.json` 的 `hooks` 对象中**追加**以下条目（保留既有条目）：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/crg_build/crg_build.js\"",
            "timeout": 10,
            "async": true
          },
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/graphify_build/graphify_build.js\"",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/crg_update/crg_update.js\"",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/grep_nudge/grep_nudge.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Windows 用户：把 `$HOME` 替换成展开后的实际路径（如 `C:/Users/<you>/.claude`），或保留并依赖 shell 展开。

加完后验证 JSON 合法性：

```bash
python -c "import json; json.load(open('$HOME/.claude/settings.json', encoding='utf-8'))" && echo "OK"
```

---

## 四、持久提示词

本插件不再向 `CLAUDE.md` / `AGENTS.md` 追加持久提示词。图谱使用建议只通过 Grep / Agent 的运行时短提示提供，避免长期占用上下文。

---

## 五、部署后自检

```bash
# 1. 每个 hook 文件 node --check
node --check "$HOME/.claude/hooks/js/crg_build/crg_build.js"
node --check "$HOME/.claude/hooks/js/crg_update/crg_update.js"
node --check "$HOME/.claude/hooks/js/graphify_build/graphify_build.js"
node --check "$HOME/.claude/hooks/js/grep_nudge/grep_nudge.js"

# 2. lib 模块可加载
node -e "console.log(typeof require('$HOME/.claude/hooks/js/lib/utils').commandExists)"
# 预期输出: function
node -e "console.log(typeof require('$HOME/.claude/hooks/js/lib/ensure_deps').spawnPrewarm)"
# 预期输出: function
```

全部通过即视为安装完成。重启 Claude Code 让 settings.json 生效。

---

## 六、卸载

```bash
rm -rf ~/.claude/hooks/js/crg_build
rm -rf ~/.claude/hooks/js/crg_update
rm -rf ~/.claude/hooks/js/graphify_build
rm -rf ~/.claude/hooks/js/grep_nudge
rm -f  ~/.claude/hooks/js/lib/ensure_deps.js
rm -f  ~/.claude/commands/codemap-boost-setup.md
# lib/utils.js 可能被其它 hook 共用，谨慎删除
```

同时移除 `settings.json` 中的 hook 条目。旧版本曾写入的 `CLAUDE.md` 标记片段可直接删除。
