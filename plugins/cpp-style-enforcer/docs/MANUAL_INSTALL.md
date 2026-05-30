# cpp-style-enforcer 手动安装指南

本指南适用于不使用 `/plugin` 命令的用户。手动将 hook 文件部署到 `~/.claude/` 并在 `settings.json` 注册。

> **注意**：手动安装时 `CLAUDE_PLUGIN_ROOT` 环境变量不可用，所有路径均使用展开后的实际路径。本插件 hook 脚本对子脚本 / cpplint.py / 模板的引用全部基于 `__dirname` 相对定位，因此**只要保持目录层级一致**，部署到 `~/.claude/hooks/js/` 下即可正常工作。

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
python --version        # 3.x（cpplint 用；缺失则 lint 静默跳过）
clang-format --version  # 可选；缺失则格式化跳过
```

Python / clang-format 缺失**不报错**——hook 内部 `commandExists` 静默降级。

---

## 二、文件部署

将本仓库 `plugins/cpp-style-enforcer/` 下的文件拷贝到 `~/.claude/` 对应位置，**保持目录层级**。

参考命令（Bash）：

```bash
REPO="/path/to/bugdb-impl/plugins/cpp-style-enforcer"
DEST="$HOME/.claude"

# hooks（保持层级，子脚本互相用 __dirname 定位）
mkdir -p "$DEST/hooks/js/lib" \
         "$DEST/hooks/js/cpp_style_guard" \
         "$DEST/hooks/js/post_edit_pipeline" \
         "$DEST/hooks/js/copyright" \
         "$DEST/hooks/js/cpplint" \
         "$DEST/hooks/js/pre_commit_lint"

cp "$REPO/hooks/js/lib/utils.js"                            "$DEST/hooks/js/lib/"
cp "$REPO/hooks/js/cpp_style_guard/cpp_style_guard.js"      "$DEST/hooks/js/cpp_style_guard/"
cp "$REPO/hooks/js/cpp_style_guard/readme.txt"              "$DEST/hooks/js/cpp_style_guard/"
cp "$REPO/hooks/js/post_edit_pipeline/post_edit_pipeline.js" "$DEST/hooks/js/post_edit_pipeline/"
cp "$REPO/hooks/js/copyright/copyright_header.js"           "$DEST/hooks/js/copyright/"
cp "$REPO/hooks/js/cpplint/cpplint_check.js"                "$DEST/hooks/js/cpplint/"
cp "$REPO/hooks/js/cpplint/cpplint.py"                      "$DEST/hooks/js/cpplint/"
cp "$REPO/hooks/js/pre_commit_lint/pre_commit_lint.js"      "$DEST/hooks/js/pre_commit_lint/"

# 用户级模板（首次 SessionStart 也会自动复制；这里手动放一份更稳妥）
cp "$REPO/templates/cpp-style-template.default.json"        "$DEST/cpp-style-template.json"

# 命令
mkdir -p "$DEST/commands"
cp "$REPO/commands/cpp-style-setup.md" "$DEST/commands/"
```

> **重要**：`cpp_style_guard.js` 用相对路径 `../../../templates/cpp-style-template.default.json`
> 定位出厂模板。手动安装时该模板不在 `~/.claude/hooks/js/...` 同级层级下，
> 因此请**手动把模板放到 `~/.claude/cpp-style-template.json`**（上面已含该步），
> 这样 `ensureUserTemplate` 检测到已存在即不再依赖出厂模板路径。

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
            "command": "node \"$HOME/.claude/hooks/js/cpp_style_guard/cpp_style_guard.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*(?:write|edit|create|replace|insert)",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/post_edit_pipeline/post_edit_pipeline.js\"",
            "timeout": 30
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/js/pre_commit_lint/pre_commit_lint.js\"",
            "timeout": 30
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

## 四、部署后自检

```bash
# 1. 每个 hook 文件 node --check
node --check "$HOME/.claude/hooks/js/cpp_style_guard/cpp_style_guard.js"
node --check "$HOME/.claude/hooks/js/post_edit_pipeline/post_edit_pipeline.js"
node --check "$HOME/.claude/hooks/js/copyright/copyright_header.js"
node --check "$HOME/.claude/hooks/js/cpplint/cpplint_check.js"
node --check "$HOME/.claude/hooks/js/pre_commit_lint/pre_commit_lint.js"

# 2. utils.js 可加载
node -e "console.log(typeof require('$HOME/.claude/hooks/js/lib/utils').getCppStyleMode)"
# 预期输出: function
```

全部通过即视为安装完成。重启 Claude Code 让 settings.json 生效。

---

## 五、配置公司名（一次性）

编辑 `~/.claude/cpp-style-template.json` 的 `copyrightInfo`：

```json
{
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": { "company": "Your Company", "author": "you@example.com", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

之后新项目首次被检测时自动继承。`company` 留空 = 默认不写版权头。

---

## 六、卸载

```bash
rm -rf ~/.claude/hooks/js/cpp_style_guard
rm -rf ~/.claude/hooks/js/post_edit_pipeline
rm -rf ~/.claude/hooks/js/copyright
rm -rf ~/.claude/hooks/js/cpplint
rm -rf ~/.claude/hooks/js/pre_commit_lint
rm -f  ~/.claude/commands/cpp-style-setup.md
rm -f  ~/.claude/cpp-style-template.json   # 如不再需要
# lib/utils.js 可能被其它 hook 共用，谨慎删除
```

同时移除 `settings.json` 中对应的 hook 条目。各项目根目录的 `.claude-cpp-style` 可按需删除。
