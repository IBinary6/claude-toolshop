# /bugdb-setup — 一键完成插件配置

安装 bugdb-knowledge 插件后执行此命令，自动完成环境检测、Python 包安装、CLAUDE.md 触发规则追加。

## 执行流程

按以下步骤依次执行。**遇到决策点必须使用 AskUserQuestion 工具询问用户，不要假设**。

### Step 1: 检测 Python

执行：

```bash
python -c "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}.{v.micro}')"
```

根据结果分三种情况：

- **退出码非 0 / 命令找不到** → Python 不可用，跳到 Step 2
- **输出版本但 < 3.11** → Python 版本不够，跳到 Step 2
- **输出版本且 ≥ 3.11** → 直接跳到 Step 3

### Step 2: 引导安装 Python（仅 Step 1 失败时进入）

**必须用 AskUserQuestion 工具询问用户**，给出两个选项：

- 选项 A：「让 Claude 自动帮我装」
- 选项 B：「我自己装，装完再重跑 /bugdb-setup」

#### 用户选 A（自动安装）

根据当前平台执行：

- **Windows**：先试 `winget install -e --id Python.Python.3.11 --scope user`；winget 不可用则退回 `scoop install python`（若两者均无，转选项 B 并提示用户先装 winget 或 scoop）
- **macOS**：`brew install python@3.11`（无 brew 则转选项 B 并提示用户先装 brew）
- **Linux**：**不要替用户跑** `apt`/`dnf`/`pacman`（需要 sudo）。改为打印发行版对应命令让用户复制执行，然后停下等用户装完再让用户重跑 `/bugdb-setup`

装完后**重新执行 Step 1** 验证。若 `python` 仍不在 PATH 上（新装的可执行文件未刷新 PATH），提示用户重开终端 / Claude Code 再跑 `/bugdb-setup`，然后停下。

#### 用户选 B（自己装）

输出一句话提示「装完后重新执行 `/bugdb-setup`」，停下。**不要继续往后跑**。

### Step 3: 安装 Python 包

```bash
python -m pip install -e "${CLAUDE_PLUGIN_ROOT}"
```

失败按 stderr 报告并停止。若提示权限问题（写入系统目录失败），追加 `--user` 重试一次。

### Step 4: 验证 CLI

```bash
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" stats --format text
```

失败则报告错误并停止。

### Step 5: 追加 CLAUDE.md 触发规则

检查 `~/.claude/CLAUDE.md` 是否已包含 `bugdb-lookup` 关键词：

- **已包含** → 跳过
- **不包含 / 文件不存在** → 追加（或创建）以下内容到文件末尾：

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

### Step 6: 汇报结果

简短输出（不超过 5 行）：

```
bugdb-setup 完成：
  ✓ Python <版本>
  ✓ Python 包已安装
  ✓ CLAUDE.md 触发规则已配置

使用 /bugsearch <关键词> 搜索，/bugfix 手动录入。
后续升级：/plugin marketplace update claude-toolshop 后重启 Claude Code。
```

## 约束

- 决策点必须用 AskUserQuestion 工具，不得自作主张
- 不得替用户执行需要 sudo / 管理员权限的命令
- 不得修改插件 `pyproject.toml` 的 `requires-python`
- 任一步骤失败必须明确报告，不得静默跳过
- 不得修改用户 CLAUDE.md 中已有的内容，只追加
