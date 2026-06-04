# /codemap-pro-setup — CodeGraph 前置依赖检测 + 可选修复

**可选命令**。codemap-pro 装好后会在 SessionStart 后台预热 CodeGraph 并维护项目图谱，不再向 `CLAUDE.md` / `AGENTS.md` 注入持久提示词；本命令用于显式检查和修复底层 CodeGraph CLI / MCP / hook 文件。

## 执行流程

按以下步骤依次执行。**遇到决策点必须使用 AskUserQuestion 工具询问用户，不要假设**。

### Step 1: 检测 Node.js 与 npm

执行：

```bash
node --version
npm --version
```

- `node` 不存在或版本 < 18：进入 Step 2
- `npm` 不存在：进入 Step 2
- 都可用：进入 Step 3

### Step 2: 引导安装 Node.js / npm

Node.js / npm 通常需要管理员权限或包管理器权限，**不要替用户执行**，只打印命令：

- Windows：`winget install -e --id OpenJS.NodeJS.LTS` 或 `scoop install nodejs-lts`
- macOS：`brew install node@20`
- Linux：`sudo apt install nodejs npm` / `sudo dnf install nodejs npm` / `sudo pacman -S nodejs npm`

明确告诉用户：安装完成后需要重开终端 / Claude Code，让 PATH 刷新，然后重跑 `/codemap-pro-setup`。停下，不继续后续步骤。

### Step 3: 检测 CodeGraph CLI

执行：

```bash
codegraph --version
```

- 存在：进入 Step 5
- 不存在：进入 Step 4

### Step 4: 安装 CodeGraph CLI

必须用 AskUserQuestion 询问用户：

- 选项 A：「帮我安装」→ 执行：

```bash
npm install -g @colbymchenry/codegraph --no-audit --no-fund
```

安装后复跑 `codegraph --version`。成功进入 Step 5；失败则报告 stderr，并打印同一安装命令让用户手动处理。

- 选项 B：「打印命令，我自己装」→ 打印上面的安装命令，告知装完后重开 Claude Code 并重跑 `/codemap-pro-setup`，然后停下。

### Step 5: 验证 CodeGraph MCP 注册

先检查 `~/.claude.json` 或 `~/.claude/settings.json` 中是否已有 `mcpServers.codegraph`。如果已存在，进入 Step 6。

如果未注册，直接执行：

```bash
codegraph install --target=claude --yes
```

成功后提示用户重启 Claude Code 以加载 MCP Server。

如果执行失败，报告 stderr，并打印同一手动命令。

### Step 6: 验证 hook 文件语法

执行：

```bash
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_init/cg_init.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_sync/cg_sync.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_worktree/cg_worktree.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_gitignore/cg_gitignore.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/grep_nudge/grep_nudge.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/agent_nudge/agent_nudge.js"
```

任一失败：报告 stderr，建议重装 codemap-pro。全部通过后进入 Step 7。

### Step 7: 可选触发当前项目初始化

检测当前目录是否为 Git 仓库：

```bash
git rev-parse --is-inside-work-tree
```

如果是 Git 仓库且 `.codegraph/codegraph.db` 不存在，必须用 AskUserQuestion 询问用户：

- 选项 A：「现在初始化」→ 执行 `codegraph init -i .`
- 选项 B：「稍后由 hook 后台初始化」→ 不执行

如果 `.codegraph/codegraph.db` 已存在，可执行：

```bash
codegraph sync .
```

作为兜底增量同步；失败只报告，不修改配置。

### Step 8: 汇报结果

简短输出：

```text
codemap-pro-setup 完成：
  ✓ Node.js <版本>
  ✓ npm <版本>
  ✓ codegraph CLI <版本>
  ✓ CodeGraph MCP <已注册/本次注册>
  ✓ hook 文件 node --check 通过
  ✓ 当前项目 .codegraph <已存在/本次初始化/等待 hook 初始化>
```

## 约束

- 决策点必须使用 AskUserQuestion 工具。
- 不要替用户安装 Node.js / npm。
- `npm install -g` 必须在用户选择「帮我安装」后才能执行。
- 失败必须明确报告，不得静默跳过。
- 不直接编辑用户 CLAUDE.md / AGENTS.md；不得新增持久提示词注入。
