# codemap-boost — 自动维护代码结构图

让 Claude 的代码搜索能力从「纯文本 grep」升级为「符号 + 调用关系」级别的图谱检索。

**内置 code-review-graph 与 Serena**：安装插件后，会话启动时在后台把二者装进插件数据目录的独立 venv，MCP 由插件自带的 `.mcp.json` 启动，不需要 `pip install`，也不需要在 cc-switch 或 `~/.claude.json` 里另外注册。hook 会自动构建和更新图谱；真正调用图谱 MCP 前还会同步等待一次 build/update，避免读取过期图谱。

## 与 Codex 版的语义对应

两边追求同一条用户语义：**安装后主动维护代码图，结构类问题优先用图谱，读取图谱前保证刷新完成**。

| 语义能力 | Claude Code 版 | Codex 版 |
|---|---|---|
| 会话启动维护图谱 | `SessionStart` 后台 build/update，缺 CLI 时提示 setup | `SessionStart` 自动 bootstrap 并同步 build/update |
| 修改后更新图谱 | `PostToolUse` 覆盖内置编辑、Shell 与 MCP 补丁，`CwdChanged` 处理目录切换 | `PostToolUse` 同步刷新 |
| 读取前屏障 | 图谱 MCP `PreToolUse` 同步刷新，失败则 deny | 图谱 MCP `PreToolUse` 同步刷新，失败则 deny |
| grep/subagent 引导 | `Grep` 提示主代理，`SubagentStart` 直接把规则注入新子代理 | `Bash` / prompt / subagent 软提示优先用图谱 |
| 依赖安装 | `SessionStart` 后台把 CRG / Serena 装进插件私有 venv，`.mcp.json` 自带 MCP | Codex 插件在 SessionStart / MCP 启动时自动 bootstrap |

Claude 版只写插件自己的数据目录（`CLAUDE_PLUGIN_DATA`），不触碰全局 Python 环境，也不写用户级 MCP 配置；与 Codex 版的差异是不带每周后台自动更新，Serena 固定为 1.7.0，CRG 取最新稳定版，升级通过更新插件版本完成。

---

## 前置依赖与内置运行时

| 依赖 | 必需 | 说明 |
|------|------|------|
| Node.js 18+ | **是** | hook 与 MCP 启动器的运行时，需自备 |
| `uv` 或 Python 3.11+ | **是**（首次安装用） | 用来创建私有 venv；优先 `uv`，其次 `py -3.12/-3.11`、`python3.12`、`python`。可用 `CODEMAP_BOOST_PYTHON` 指定 |
| 联网 | 首次安装需要 | 从 PyPI 安装 CRG（约 300MB）与 `serena-agent==1.7.0` |
| `graphify` CLI | 可选 | 概念图谱，仍是外部命令：`pip install "graphifyy[all]"` |

私有环境位于 `${CLAUDE_PLUGIN_DATA}/crg-runtime` 与 `serena-runtime/1.7.0`，随插件卸载一并清理。安装有进程锁，失败会写 `.crg-install-failed` / `.serena-install-failed` 诊断。`/codemap-boost-setup` 只做检查与排障。

**关于 CRG 的 embeddings**：为避免 `serve` 启动时无条件预热 sentence-transformers（实测 13–27 秒，逼近 Claude Code 默认 30 秒的 MCP 启动超时），内置版安装 `code-review-graph[communities]`，不含向量模型；语义搜索在无向量时退化为 FTS 关键词。需要向量时自行设置 `CODEMAP_BOOST_PYTHON` 并在私有 venv 里安装 `sentence-transformers`，同时把 `MCP_TIMEOUT` 调大。

**首次使用**：第一次会话 MCP 可能早于安装完成而连接失败，装好后运行 `/mcp` 重连 `plugin:codemap-boost:*` 即可。Serena 会在项目里生成 `.serena/`（缓存与项目配置），建议加入 `.gitignore`。

**工具名**：`mcp__plugin_codemap-boost_code-review-graph__*`、`mcp__plugin_codemap-boost_serena__*`。若之前用 cc-switch 或 `~/.claude.json` 注册过同名 MCP，请取消，避免重复。

---

## 安装

### 方式一：Plugin Marketplace（推荐）

在 Claude Code 中**逐条**执行：

```
/plugin marketplace add IBinary6/claude-toolshop
```

```
/plugin install codemap-boost@claude-toolshop
```

```
/codemap-boost-setup
```

第三步会诊断内置 CRG / Serena 私有环境，并确认 hook 文件完好；通常装完插件后后台已自动安装，这一步可省略。插件不再向 `CLAUDE.md` / `AGENTS.md` 写入持久提示词。

#### 升级

```
/plugin marketplace update claude-toolshop
```

然后**完全退出 Claude Code 再打开**——hook / command 元数据只在启动时加载，必须重启才能生效。

### 方式二：手动安装

详见 [docs/MANUAL_INSTALL.md](./docs/MANUAL_INSTALL.md)。

---

## 它能做什么？

提供两个自动化能力，让你**不用再手动维护代码结构图**：

| 能力 | 触发时机 | 你不用做的事 |
|------|---------|-------------|
| **自动构建** | 打开会话时 | 手动跑 `code-review-graph build` / `graphify .` |
| **增量更新** | 改完文件后 | 手动跑 `code-review-graph update` |
| **读取前刷新** | 调用图谱 MCP 前 | 担心 MCP 读到旧图谱 |

此外还有轻量运行时提示 hook：Grep 触发主代理提示，SubagentStart 直接给新子代理注入同一套规则。Claude Code 延迟加载 MCP 工具时，提示会要求先通过 ToolSearch 发现工具；该提示不落盘。

> setup 完成后该干啥干啥，图谱会跟着你的代码自动刷新。

---

## 卸载

```
/plugin uninstall codemap-boost@claude-toolshop
```

重启 Claude Code。

---

## 协议

MIT
