# BugDB 安装与集成指南

本项目用户目录用 **CC Switch** 管理，工具直接改 `~/.claude/settings.json` / `~/.claude/CLAUDE.md` 会被覆盖。下面的内容请由用户手动落地。

---

## 一、文件部署

把实现目录内的文件按下表拷贝到 `~/.claude/` 对应位置（路径区分大小写）。

| 源（本仓库） | 目标 |
|---|---|
| `scripts/bugdb/` | `~/.claude/scripts/bugdb/` |
| `commands/bugfix.md` | `~/.claude/commands/bugfix.md` |
| `commands/bugsearch.md` | `~/.claude/commands/bugsearch.md` |
| `hooks/js/bugdb_check/bugdb_check.js` | `~/.claude/hooks/js/bugdb_check/bugdb_check.js` |

Skills 已直接落在仓库根 `D:/AI/cc-swtich/ccswitch-self/skills/bugdb-lookup/` 和 `.../bugdb-record/`，无需移动。

数据库 `~/.claude/bugs.db` 由 CLI 首次执行时自动建表。

---

## 二、settings.json 待加片段

在 `~/.claude/settings.json` 的 `hooks.PostToolUse` 数组中追加以下条目（**保留既有条目，仅追加**）：

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "node -e \"H=require('os').homedir();require(H+'/.claude/hooks/launcher.js')('js/bugdb_check/bugdb_check')\"",
    "timeout": 5000,
    "async": true
  }]
}
```

加完后验证 JSON 合法：

```bash
python -c "import json; json.load(open(r'C:/Users/ibinary/.claude/settings.json', encoding='utf-8'))" && echo OK
```

> 若 CC Switch 也管理 hooks 配置，应把上述片段加到 CC Switch 的对应 profile 模板里，而不是直接改 settings.json。

---

## 三、CLAUDE.md 待加片段

在 `~/.claude/CLAUDE.md` 文末追加：

```markdown

## 8. Bug 知识库触发规则

遇到以下情况，调用 bugdb-lookup skill：

- 任何编译错误（error C*, error:, fatal error）
- 任何链接错误（LNK*, unresolved external）
- 任何构建工具失败（cmake, ninja, msbuild, make FAILED）
- 任何运行时崩溃（access violation, segfault, ModuleNotFoundError）

成功解决 bug 后，评估复现概率 > 50% 则调用 bugdb-record skill 录入。

跨语言错误以报错栈顶语言为准。
```

> 同样：若 CLAUDE.md 由 CC Switch 模板生成，把片段加到模板里。

---

## 四、部署后自检

```bash
# 1. CLI 自检
python ~/.claude/scripts/bugdb/cli.py stats

# 2. 录入一条
python ~/.claude/scripts/bugdb/cli.py add \
  --error-type link \
  --error-message "error LNK2001: unresolved external symbol __imp_WSAStartup" \
  --root-cause "missing ws2_32.lib" \
  --solution "link ws2_32.lib" \
  --solution-steps '["open","link"]' \
  --language c++ --project-type vs --tags "linker"

# 3. 搜索命中
python ~/.claude/scripts/bugdb/cli.py search --query "LNK2001 __imp_WSAStartup" --language c++

# 4. Hook 可加载
node -e "const f = require(require('os').homedir() + '/.claude/hooks/js/bugdb_check/bugdb_check.js'); console.log(typeof f === 'function' ? 'ok' : 'fail');"
```

均成功则集成完毕。
