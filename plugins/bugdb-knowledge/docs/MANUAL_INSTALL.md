# BugDB Knowledge 手动安装指南

本指南适用于不使用 `/plugin` 命令的 CC Switch 用户。手动将 BugDB 插件文件部署到 `~/.claude/` 目录。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` 环境变量不可用，所有路径均使用展开后的实际路径。

---

## 一、前置条件

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Python | 3.10+ | BugDB CLI 核心（数据库、搜索） |
| Node.js | 18+ | PostToolUse Hook 运行时 |

验证：

```bash
python --version   # >= 3.10
node --version     # >= 18
```

---

## 二、文件部署

将本仓库 `plugins/bugdb-knowledge/` 下的文件拷贝到 `~/.claude/` 对应位置。

| 源（本仓库 `plugins/bugdb-knowledge/`） | 目标 |
|---|---|
| `scripts/bugdb/` | `~/.claude/scripts/bugdb/` |
| `commands/bugfix.md` | `~/.claude/commands/bugfix.md` |
| `commands/bugsearch.md` | `~/.claude/commands/bugsearch.md` |
| `hooks/js/bugdb_check/bugdb_check.js` | `~/.claude/hooks/js/bugdb_check/bugdb_check.js` |
| `skills/bugdb-lookup/SKILL.md` | `~/.claude/skills/bugdb-lookup/SKILL.md` |
| `skills/bugdb-record/SKILL.md` | `~/.claude/skills/bugdb-record/SKILL.md` |

参考命令（以 Bash 为例，请根据实际仓库路径替换 `$REPO`）：

```bash
REPO="/path/to/bugdb-impl/plugins/bugdb-knowledge"

# 脚本
mkdir -p ~/.claude/scripts/bugdb
cp -r "$REPO"/scripts/bugdb/*.py ~/.claude/scripts/bugdb/

# 斜杠命令
mkdir -p ~/.claude/commands
cp "$REPO"/commands/bugfix.md   ~/.claude/commands/
cp "$REPO"/commands/bugsearch.md ~/.claude/commands/

# Hook
mkdir -p ~/.claude/hooks/js/bugdb_check
cp "$REPO"/hooks/js/bugdb_check/bugdb_check.js ~/.claude/hooks/js/bugdb_check/

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
      "command": "node -e \"H=require('os').homedir();const p=require('path');const{execSync}=require('child_process');const m=require(p.join(H,'.claude','hooks','js','bugdb_check','bugdb_check.js'));m({toolName:'Bash',toolInput:process.env.CLAUDE_TOOL_INPUT||'',toolResult:{stdout:process.env.CLAUDE_TOOL_STDOUT||'',stderr:process.env.CLAUDE_TOOL_STDERR||''}})\"",
      "timeout": 5000,
      "async": true
    }
  ]
}
```

> **重要**：手动安装时 hook 内部的 `CLAUDE_PLUGIN_ROOT` 不可用。`bugdb_check.js` 会回退到 `~/.claude/plugins/bugdb-knowledge/scripts/bugdb/cli.py`，但手动安装的 CLI 位于 `~/.claude/scripts/bugdb/cli.py`。如果你只做手动部署（不拷贝到 `plugins/` 目录），需要确保 hook 能找到 CLI。有两种方式：
>
> 1. **推荐**：在 settings.json hook command 前设置环境变量覆盖路径（见下方替代写法）。
> 2. **替代**：在 `~/.claude/plugins/bugdb-knowledge/scripts/bugdb/` 也放一份 CLI（即同时拷贝到 plugins 目录）。

替代 hook command（显式指定 CLI 路径）：

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "node -e \"process.env.BUGDB_CLI_PATH=require('path').join(require('os').homedir(),'.claude','scripts','bugdb','cli.py');H=require('os').homedir();require(require('path').join(H,'.claude','hooks','js','bugdb_check','bugdb_check.js'))({toolName:'Bash',toolInput:'',toolResult:{stdout:process.env.CLAUDE_TOOL_STDOUT||'',stderr:process.env.CLAUDE_TOOL_STDERR||''}})\"",
      "timeout": 5000,
      "async": true
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

```bash
# 1. CLI 状态检查
python ~/.claude/scripts/bugdb/cli.py stats

# 2. 录入一条测试记录
python ~/.claude/scripts/bugdb/cli.py add \
  --error-type link \
  --error-message "error LNK2001: unresolved external symbol __imp_WSAStartup" \
  --root-cause "missing ws2_32.lib" \
  --solution "link ws2_32.lib" \
  --solution-steps '["target_link_libraries(... ws2_32)"]' \
  --language c++ --project-type vs --tags "linker"

# 3. 搜索验证
python ~/.claude/scripts/bugdb/cli.py search \
  --query "LNK2001 __imp_WSAStartup" --language c++

# 4. Hook 加载检查
node -e "
  const f = require(require('os').homedir() + '/.claude/hooks/js/bugdb_check/bugdb_check.js');
  console.log(typeof f === 'function' ? 'OK: hook loaded' : 'FAIL: not a function');
"
```

预期输出：
- 步骤 1：显示数据库统计信息（首次安装记录数为 0）
- 步骤 2：成功录入并返回记录 ID
- 步骤 3：搜索命中刚录入的记录
- 步骤 4：输出 `OK: hook loaded`

---

## 六、卸载

删除已部署的文件即可：

```bash
rm -rf ~/.claude/scripts/bugdb
rm -f  ~/.claude/commands/bugfix.md
rm -f  ~/.claude/commands/bugsearch.md
rm -rf ~/.claude/hooks/js/bugdb_check
rm -rf ~/.claude/skills/bugdb-lookup
rm -rf ~/.claude/skills/bugdb-record
```

同时移除 `settings.json` 中的 hook 条目和 `CLAUDE.md` 中的触发规则片段。
