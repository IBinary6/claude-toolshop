---
description: 检查并修复 CodeMap Boost 内置的 code-review-graph / Serena 私有运行环境
---

# /codemap-boost-setup — 内置运行环境检查

code-review-graph 与 Serena 随插件内置：会话启动时后台装进插件数据目录（`${CLAUDE_PLUGIN_DATA}` 下的独立 venv），MCP 由插件自带的 `.mcp.json` 启动，**不需要全局 `pip install`，也不需要 `code-review-graph install` 或用户级 MCP 注册**。本命令只用于检查和排障，不做交互式安装。

## 执行流程

1. 检查 Node.js：`node --version`，需要 18+；缺失只打印安装命令（`winget install -e --id OpenJS.NodeJS.LTS` / `brew install node@20` / `sudo apt install nodejs npm`），不替用户执行，然后停下。
2. 只读诊断：

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-runtime.cjs" --doctor
   ```

   输出 JSON，包含 `dataDir`、`crg.ok`、`serena.ok` 及各自的 `failure` 诊断。
3. 任一项 `ok` 为 `false`：说明首次后台安装未完成或失败。先让用户确认网络可用，并且有 `uv` 或 Python 3.11+；然后经用户同意运行安装（首次需数分钟，CRG 约 300MB）：

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-runtime.cjs"
   ```

   找不到合适的 Python 时，可设置环境变量 `CODEMAP_BOOST_PYTHON`（以及 `CODEMAP_BOOST_PYTHON_ARGS`）指向解释器后重试。装完重跑第 2 步确认。
4. 可选的 `graphify`（概念图谱，仍是外部 CLI）：`graphify --version`；缺失时经用户同意执行 `python -m pip install "graphifyy[all]"`（包名双 y）。
5. 校验 hook 脚本可被 Node 解析：对 `hooks/js` 下 `runtime_bootstrap`、`crg_build`、`crg_update`、`crg_worktree`、`grep_nudge`、`agent_nudge`、`pre_graph_tool` 各脚本执行 `node --check`。
6. 提醒用户：MCP 在会话启动时连接。首次安装完成后在 Claude Code 里运行 `/mcp` 重连 `plugin:codemap-boost:*` 即可，不必重开会话。若同名 MCP 之前由 cc-switch 或 `~/.claude.json` 注册过，请取消注册，避免与内置版本重复。

## 汇报

简短输出（不超过 8 行），显式列出 Node.js、CRG、Serena、graphify（可选）和 hook 检查的状态；失败项标 ✗ 并给出对应命令。

## 约束

- 不修改用户 CLAUDE.md / AGENTS.md，不写用户级 MCP 配置，不执行需要管理员权限的命令。
- 安装需要联网，执行前必须征得用户同意；任一步骤失败必须明确报告，不得静默跳过。
- 工具名为 `mcp__plugin_codemap-boost_code-review-graph__*` 与 `mcp__plugin_codemap-boost_serena__*`；MCP schema 可能被延迟加载，先用 ToolSearch 发现，不能仅因列表未显示就断言不可用。
