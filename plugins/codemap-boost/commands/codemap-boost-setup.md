# /codemap-boost-setup — 前置依赖检测 + 可选自动安装

**可选命令**。codemap-boost 装好后 CLAUDE.md 触发规则会由 SessionStart hook 自动追加，无需手动跑这个命令。

它做两件事：**检测前置依赖是否齐全**；缺失时**询问你是否让我直接帮你装**（pip 包可自动装，需管理员的只打印命令）。

## 执行流程

按以下步骤依次执行。**遇到决策点必须使用 AskUserQuestion 工具询问用户，不要假设**。

> 前置依赖（Node.js / code-review-graph / graphify）**全部必需**，缺任一项对应 hook 不会工作。

### Step 1: 检测 Node.js

执行：

```bash
node --version
```

- **退出码非 0 / 命令找不到** → Node 不可用，跳到 Step 2
- **输出版本但 < 18** → Node 版本不够，跳到 Step 2
- **输出 v18+** → 直接跳到 Step 3

### Step 2: 引导安装 Node.js（仅 Step 1 失败时进入）

Node.js 安装通常需要管理员权限（winget / brew / apt），**不替用户执行**，只打印命令。

**必须用 AskUserQuestion 工具询问用户**，给出两个选项：

- 选项 A：「打印安装命令给我，我自己复制运行」
- 选项 B：「我自己装，装完再重跑 /codemap-boost-setup」

无论选哪个，都按当前平台打印对应命令（**不主动执行**）：

- **Windows**：`winget install -e --id OpenJS.NodeJS.LTS` 或 `scoop install nodejs-lts`
- **macOS**：`brew install node@20`
- **Linux**：`sudo apt install nodejs npm` / `sudo dnf install nodejs` / `sudo pacman -S nodejs npm`

明确告诉用户：装完后需要**重开终端 / Claude Code** 让 PATH 刷新，然后重跑 `/codemap-boost-setup`。停下，**不要继续往后跑**（Node 缺失后续步骤无意义）。

### Step 3: 选择安装级别

**必须用 AskUserQuestion 工具询问用户**：

code-review-graph 提供三种安装级别：

- 选项 A：**完整安装（推荐）** `pip install "code-review-graph[all]"` — 含语义嵌入、社区检测、所有分析功能（约 500MB）
- 选项 B：**嵌入增强** `pip install "code-review-graph[embeddings]"` — 仅含语义搜索能力（约 300MB）
- 选项 C：**核心功能** `pip install code-review-graph` — 最小安装，FTS5 关键词搜索、无语义搜索（约 50MB）

记住用户的选择，在后续 Step 4 中使用对应的 pip 包名进行安装。

### Step 4: 检测 code-review-graph CLI（pip 包，可自动装）

执行：

```bash
code-review-graph --version
```

- **存在** → 继续 Step 5
- **找不到命令** → **必须用 AskUserQuestion** 询问用户：
  - 选项 A：「帮我装」→ 先确认 Python/pip 可用（`python -m pip --version`，失败则 `python3 -m pip --version`），然后根据 Step 3 用户选择执行对应的安装命令（如 `python -m pip install "code-review-graph[all]"`）。装完复跑 `code-review-graph --version` 验证；成功继续 Step 5，失败报告 stderr 并停下。
  - 选项 B：「打印命令，我自己装」→ 打印 Step 3 选择对应的安装命令，告知装完重开 Claude Code，停下。

### Step 5: 检测 graphify CLI（pip 包，可自动装）

执行：

```bash
graphify --version
```

- **存在** → 继续 Step 6
- **找不到命令** → **必须用 AskUserQuestion** 询问用户：
  - 选项 A：「帮我装」→ 执行 `python -m pip install graphifyy`（pip 包名是 `graphifyy`，它提供 `graphify` 命令；用 Step 4 验证过的解释器）。装完复跑 `graphify --version` 验证；成功继续 Step 6，失败报告 stderr 并停下。
  - 选项 B：「打印命令，我自己装」→ 打印 `python -m pip install graphifyy`，告知装完重开 Claude Code，停下。

### Step 6: 验证 hook 文件可被 Node 解析

执行（依次校验所有 hook 文件能被 node 解析；不实际运行业务逻辑）：

```bash
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/claudemd_inject/claudemd_inject.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/crg_build/crg_build.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/crg_update/crg_update.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/crg_worktree/crg_worktree.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/graphify_build/graphify_build.js"
node --check "${CLAUDE_PLUGIN_ROOT}/hooks/js/grep_nudge/grep_nudge.js"
```

任一失败 → 报告 stderr 并停止（说明插件文件损坏，需要重装）。
全部通过 → 继续 Step 6.5。

### Step 6.5: 验证 MCP 服务器注册

检查 code-review-graph MCP 服务器是否已注册到 settings.json。

**检测方法**（按优先级选择一种）：

1. **方法 A（推荐）**：读取 `~/.claude/settings.json`，解析 JSON，检查 `mcpServers` 字段中是否有 `code-review-graph` 键。

2. **方法 B（备选）**：执行 `code-review-graph install --dry-run`（如果该命令支持 dry-run 参数）。

**结果判断**：

- **已注册** → 继续 Step 7
- **未注册** → **必须用 AskUserQuestion** 询问用户：
  - 选项 A：「帮我注册」→ 执行 `code-review-graph install`。成功继续 Step 7，失败报告 stderr 并停下。
  - 选项 B：「打印命令，我自己注册」→ 打印 `code-review-graph install`，告知注册后需重启 Claude Code，停下。

### Step 7: 汇报结果

简短输出（不超过 10 行）。根据前面步骤检测/安装结果，**显式列出**前置依赖状态：

```
codemap-boost-setup 完成：
  ✓ Node.js <版本>
  ✓ code-review-graph CLI <版本><（本次自动安装，级别：[all]/[embeddings]/core）>
  ✓ graphify CLI<（本次自动安装）>
  ✓ code-review-graph MCP server <已注册/本次注册>
  ✓ hook 文件 node --check 通过（含 EnterWorktree 钩子）

CLAUDE.md 触发规则由 SessionStart hook 自动维护，无需手动配置。
Token 优化规则已内置，CRG 工具默认使用 minimal 模式。
后续升级：/plugin marketplace update claude-toolshop 后重启 Claude Code 即可。
```

若有依赖缺失或安装失败，汇报中应明确标 ✗ 并复述对应安装命令。

## 约束

- 决策点必须用 AskUserQuestion 工具，不得自作主张
- **pip 包（code-review-graph / graphify）经用户同意后可自动执行** `python -m pip install`；安装前先确认 Python/pip 可用，安装后必须复跑 `--version` 验证
- **不得替用户执行** 需要管理员 / 污染全局环境的命令（`npm install -g` / `winget` / `sudo apt` / `brew`）；Node.js 一律只打印命令
- 全程用 `python -m pip` 而非裸 `pip`，规避 PATH 上失效 shim 残留
- 前置依赖**全部必需**，缺任一项必须明确告知用户或代装，不提供"跳过"选项
- 任一步骤失败必须明确报告，不得静默跳过
- 不修改用户 CLAUDE.md —— 该工作由 `claudemd_inject` SessionStart hook 自动完成且已幂等
