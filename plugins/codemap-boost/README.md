# codemap-boost — 自动维护代码结构图

让 Claude 的代码搜索能力从「纯文本 grep」升级为「符号 + 调用关系」级别的图谱检索。

依赖准备好后，hook 会自动构建和更新图谱；真正调用图谱 MCP 前还会同步等待一次 build/update，避免 Claude 读取过期图谱。依赖安装与 MCP 注册需要先运行 `/codemap-boost-setup`。

## 与 Codex 版的语义对应

两边追求同一条用户语义：**安装后主动维护代码图，结构类问题优先用图谱，读取图谱前保证刷新完成**。

| 语义能力 | Claude Code 版 | Codex 版 |
|---|---|---|
| 会话启动维护图谱 | `SessionStart` 后台 build/update，缺 CLI 时提示 setup | `SessionStart` 自动 bootstrap 并同步 build/update |
| 修改后更新图谱 | `PostToolUse` 覆盖内置编辑、Shell 与 MCP 补丁，`CwdChanged` 处理目录切换 | `PostToolUse` 同步刷新 |
| 读取前屏障 | 图谱 MCP `PreToolUse` 同步刷新，失败则 deny | 图谱 MCP `PreToolUse` 同步刷新，失败则 deny |
| grep/subagent 引导 | `Grep` 提示主代理，`SubagentStart` 直接把规则注入新子代理 | `Bash` / prompt / subagent 软提示优先用图谱 |
| 依赖安装 | 通过 `/codemap-boost-setup` 显式确认安装 | Codex 插件可在 SessionStart 自动 bootstrap |

Claude 版不在普通 hook 中静默执行 `pip install`，这是为了避免 SessionStart 在用户未确认时修改全局 Python 环境。图谱的 build/update 本身仍是自动的。

---

## 前置依赖

| 依赖 | 最低版本 | 必需 | 安装 |
|------|---------|------|------|
| Node.js | 18+ | **是**（hook 运行时） | `winget install OpenJS.NodeJS.LTS` / `brew install node` / `apt install nodejs` |
| Python | 3.10+ | 推荐（图谱 CLI 依赖） | `winget install Python.Python.3.12` / `brew install python` / `apt install python3` |
| `code-review-graph` CLI | — | 可选但推荐 | `pip install code-review-graph` |
| `graphify` CLI | — | 可选但推荐 | `pip install "graphifyy[all]"`（包名 `graphifyy`，提供 `graphify` 命令） |

Node.js 是 hook 运行时，**必需**；`code-review-graph` / `graphify` 缺失时对应图谱功能**降级跳过、不影响其它**，但装上才有完整能力，故标「可选但推荐」。`graphify` 命令由 PyPI 包 **`graphifyy[all]`**（注意双 y）提供。

安装插件不会在 hook 里自动执行 `pip install` 或 `code-review-graph install`。首次使用前建议运行 `/codemap-boost-setup`：它会逐项检测，缺哪个就**问你要不要直接帮你装**；依赖安装到 PATH 且 MCP 注册完成后，后续打开 Claude Code 不需要重复 setup，hook 会自动 build/update 图谱。

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

第三步会检测前置依赖、缺失时问你是否代装，并确认 hook 文件完好。插件不再向 `CLAUDE.md` / `AGENTS.md` 写入持久提示词。

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
