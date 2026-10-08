# cpp-style-enforcer 手动安装指南

本指南适用于不使用 `/plugin` 命令的用户：把插件目录原样复制到本机，再在 `settings.json` 注册 hook。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` 不可用，hook 命令使用展开后的实际路径。脚本对 `lib/`、`steps/`、`cpplint.py` 与模板的引用全部基于 `__dirname`，因此**必须保持插件目录层级不变**。`CLAUDE_PLUGIN_DATA` 缺失时，待处理记录与失败标记写入系统临时目录下的 `cpp-style-enforcer/`。

---

## 一、前置条件

| 依赖 | 最低版本 | 必需 | 用途 |
|------|---------|------|------|
| Node.js | 18+ | **是** | hook 运行时 |
| Python | 3.x | cpplint 需要 | 跑内嵌 cpplint.py |
| clang-format | — | clangFormat 需要 | 代码格式化 |

验证：

```bash
node --version          # >= v18
python --version        # 3.x；Windows 也可用 py -3
clang-format --version  # 可选；缺失则跳过格式化
```

Python 缺失时 cpplint 无法执行，收尾报告与提交检查会给出 `runtime/cpplint` 条目，而不是当作零违规。

---

## 二、文件部署

```bash
REPO="/path/to/bugdb-impl/plugins/cpp-style-enforcer"
DEST="$HOME/.claude/plugins-manual/cpp-style-enforcer"

mkdir -p "$DEST"
cp -R "$REPO/hooks" "$REPO/templates" "$REPO/package.json" "$DEST/"

# 用户级模板（首次 SessionStart 也会自动复制；已存在不会被覆盖）
[ -f "$HOME/.claude/cpp-style-template.json" ] || \
  cp "$REPO/templates/cpp-style-template.default.json" "$HOME/.claude/cpp-style-template.json"

# 命令
mkdir -p "$HOME/.claude/commands"
cp "$REPO/commands/cpp-style-setup.md" "$HOME/.claude/commands/"
```

---

## 三、settings.json Hook 注册

在 `~/.claude/settings.json` 的 `hooks` 对象中**追加**以下条目（保留既有条目），把 `<DEST>` 换成上一步的实际绝对路径（Windows 使用 `C:/Users/<you>/.claude/plugins-manual/cpp-style-enforcer` 这类正斜杠路径）：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/session_start.js\"", "timeout": 10 }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|mcp__.*(?:write|edit|create|replace|insert|patch|apply|update)",
        "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/post_edit.js\"", "timeout": 10 }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/stop_check.js\"", "timeout": 60 }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/stop_check.js\"", "timeout": 60 }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node \"<DEST>/hooks/js/pre_commit.js\"", "timeout": 30 }]
      }
    ]
  }
}
```

`Stop` 与 `SubagentStop` 都必须注册：编辑时只记录文件，真正的格式化与检查在收尾时执行；缺少 `SubagentStop` 时子代理编辑的文件不会被处理。

加完后验证 JSON 合法性：

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('OK')" "$HOME/.claude/settings.json"
```

---

## 四、部署后自检

```bash
for f in session_start post_edit stop_check pre_commit; do node --check "$DEST/hooks/js/$f.js" || echo "FAIL $f"; done
echo '{}' | node "$DEST/hooks/js/stop_check.js"; echo "exit=$?"   # 预期：无输出，exit=0
```

全部通过即视为安装完成。重启 Claude Code 让 settings.json 生效。

---

## 五、配置公司名（一次性）

编辑 `~/.claude/cpp-style-template.json` 的 `copyrightInfo`：

```json
{
  "copyrightInfo": { "company": "Your Company", "author": "you@example.com", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

`company` 留空 = 不写版权头。

---

## 六、卸载

```bash
rm -rf "$HOME/.claude/plugins-manual/cpp-style-enforcer"
rm -f  "$HOME/.claude/commands/cpp-style-setup.md"
rm -f  "$HOME/.claude/cpp-style-template.json"   # 如不再需要
```

同时移除 `settings.json` 中对应的 5 个 hook 条目。各项目根目录的 `.claude-cpp-style/` 可按需删除。
