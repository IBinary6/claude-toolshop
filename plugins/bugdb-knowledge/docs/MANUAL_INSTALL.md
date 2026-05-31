# BugDB Knowledge 手动安装指南

本指南适用于不使用 `/plugin` 命令的 CC Switch 用户。手动将 BugDB 插件文件部署到 `~/.claude/` 目录。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` 环境变量不可用，所有路径均使用展开后的实际路径。

---

## 一、前置条件

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Python | 3.11+ | BugDB CLI 核心（数据库、搜索） |
| Node.js | 18+ | PostToolUse Hook 运行时 |

验证：

```bash
python --version   # >= 3.11
node --version     # >= 18
```

---

## 二、文件部署

将本仓库 `plugins/bugdb-knowledge/` 下的文件拷贝到 `~/.claude/` 对应位置。

| 源（本仓库 `plugins/bugdb-knowledge/`） | 目标 |
|---|---|
| `bugdb/` | `~/.claude/plugins/bugdb-knowledge/bugdb/` |
| `pyproject.toml` | `~/.claude/plugins/bugdb-knowledge/pyproject.toml` |
| `commands/bugfix.md` | `~/.claude/commands/bugfix.md` |
| `commands/bugsearch.md` | `~/.claude/commands/bugsearch.md` |
| `commands/bugdb-setup.md` | `~/.claude/commands/bugdb-setup.md` |
| `hooks/js/bugdb_check/bugdb_check.js` | `~/.claude/hooks/js/bugdb_check/bugdb_check.js` |
| `hooks/js/bugdb_check/bugdb_python_check.js` | `~/.claude/hooks/js/bugdb_check/bugdb_python_check.js` |
| `skills/bugdb-lookup/SKILL.md` | `~/.claude/skills/bugdb-lookup/SKILL.md` |
| `skills/bugdb-record/SKILL.md` | `~/.claude/skills/bugdb-record/SKILL.md` |

参考命令（以 Bash 为例，请根据实际仓库路径替换 `$REPO`）：

```bash
REPO="/path/to/bugdb-impl/plugins/bugdb-knowledge"
DEST="$HOME/.claude/plugins/bugdb-knowledge"

# Python 包
mkdir -p "$DEST/bugdb"
cp -r "$REPO"/bugdb/*.py "$DEST/bugdb/"
cp "$REPO"/pyproject.toml "$DEST/"

# 安装 Python 包（可选——cli.py 自带 sys.path 自举，无需 pip install 即可工作；
# 只有想用 `bugdb` 命令行 console script 时才需要执行下面这行）
# pip install -e "$DEST"

# 斜杠命令
mkdir -p ~/.claude/commands
cp "$REPO"/commands/bugfix.md   ~/.claude/commands/
cp "$REPO"/commands/bugsearch.md ~/.claude/commands/
cp "$REPO"/commands/bugdb-setup.md ~/.claude/commands/

# Hook
mkdir -p ~/.claude/hooks/js/bugdb_check
cp "$REPO"/hooks/js/bugdb_check/bugdb_check.js ~/.claude/hooks/js/bugdb_check/
cp "$REPO"/hooks/js/bugdb_check/bugdb_python_check.js ~/.claude/hooks/js/bugdb_check/

# Skills
mkdir -p ~/.claude/skills/bugdb-lookup
mkdir -p ~/.claude/skills/bugdb-record
cp "$REPO"/skills/bugdb-lookup/SKILL.md ~/.claude/skills/bugdb-lookup/
cp "$REPO"/skills/bugdb-record/SKILL.md ~/.claude/skills/bugdb-record/
```

---

## 三、settings.json Hook 注册

在 `~/.claude/settings.json` 的 `hooks.PostToolUse` 数组中**追加**以下条目（保留既有条目，仅追加）：

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/js/bugdb_check/bugdb_check.js\"",
      "timeout": 5000
    }
  ]
}
```

> **说明**：`bugdb_check.js` 是自执行脚本（`main()` 自调用），Claude Code 通过 **stdin 传入 JSON**（含 `tool_response.stdout/stderr`），脚本读 stdin、命中错误模式后向 stdout 写 `hookSpecificOutput.additionalContext`。不要把它当函数 `require(...)({...})` 调用，也不依赖 `CLAUDE_TOOL_*` 环境变量——那种写法不工作。
>
> Windows 用户：若 `$HOME` 在你的 shell 中不展开，请改用展开后的绝对路径，例如 `node "C:\\Users\\<你>\\.claude\\hooks\\js\\bugdb_check\\bugdb_check.js"`。

此外，在 `hooks.SessionStart` 数组中追加以下条目（会话启动时检测 Python 3.11+，缺失/版本不足时给一句温和提示，从不拦截）：

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/js/bugdb_check/bugdb_python_check.js\"",
      "timeout": 5000
    }
  ]
}
```

加完后验证 JSON 合法性：

```bash
python -c "import json; json.load(open('$HOME/.claude/settings.json', encoding='utf-8'))" && echo "OK"
```

> **CC Switch 用户注意**：如果 `settings.json` 由 CC Switch 的 profile 模板管理，应把上述 hook 条目加到模板中，而非直接修改 `~/.claude/settings.json`（否则切换 profile 时会被覆盖）。

---

## 四、CLAUDE.md 追加片段

在 `~/.claude/CLAUDE.md` 文末追加以下内容：

```markdown
## Bug 知识库触发规则

遇到以下情况，调用 bugdb-lookup skill：

- 任何编译错误（error C*, error:, fatal error）
- 任何链接错误（LNK*, unresolved external）
- 任何构建工具失败（cmake, ninja, msbuild, make FAILED）
- 任何运行时崩溃（access violation, segfault, ModuleNotFoundError）

成功解决 bug 后，评估复现概率 > 50% 则调用 bugdb-record skill 录入。

跨语言错误以报错栈顶语言为准。
```

> **CC Switch 用户注意**：如果 `CLAUDE.md` 由 CC Switch 模板生成，应把上述片段加到模板里，而非直接修改 `~/.claude/CLAUDE.md`。

---

## 五、部署后自检

依次执行以下命令，全部成功则安装完毕。

> **关于 `bugdb` 命令**：下面用 `bugdb <子命令>` 的地方，**仅在你执行过上面（可选的）`pip install -e` 后才可用**。若未 pip install，请把 `bugdb` 替换为
> `python "$HOME/.claude/plugins/bugdb-knowledge/bugdb/cli.py"`，例如 `python "$HOME/.claude/plugins/bugdb-knowledge/bugdb/cli.py" stats`。

```bash
# 1. CLI 状态检查
bugdb stats

# 2. 录入一条测试记录
bugdb add \
  --entry-kind bug \
  --category link \
  --context "error LNK2001: unresolved external symbol __imp_WSAStartup" \
  --cause "missing ws2_32.lib" \
  --content "link ws2_32.lib" \
  --action-steps '["target_link_libraries(... ws2_32)"]' \
  --language c++ --project-type vs --tags "linker"

# 3. 搜索验证
bugdb search --query "LNK2001 __imp_WSAStartup" --language c++

# 4. Hook 冒烟测试（stdin 传 JSON，验证脚本能跑通并命中）
echo '{"tool_response":{"stdout":"","stderr":"error LNK2001: unresolved external symbol __imp_WSAStartup"}}' \
  | node ~/.claude/hooks/js/bugdb_check/bugdb_check.js
```

预期输出：
- 步骤 1：显示数据库统计信息（首次安装记录数为 0）
- 步骤 2：成功录入并返回记录 ID
- 步骤 3：搜索命中刚录入的记录
- 步骤 4：输出一段含 `[BUGDB_MATCH]` 的 JSON（命中步骤 2 录入的记录）；若知识库为空或未命中则**无输出且退出码 0**（hook 静默是正常行为）

---

## 六、卸载

```bash
# 仅当之前执行过 pip install -e 时才需要
pip uninstall bugdb
rm -rf ~/.claude/plugins/bugdb-knowledge
rm -f  ~/.claude/commands/bugfix.md
rm -f  ~/.claude/commands/bugsearch.md
rm -f  ~/.claude/commands/bugdb-setup.md
rm -rf ~/.claude/hooks/js/bugdb_check
rm -rf ~/.claude/skills/bugdb-lookup
rm -rf ~/.claude/skills/bugdb-record
```

同时移除 `settings.json` 中的 hook 条目和 `CLAUDE.md` 中的触发规则片段。
