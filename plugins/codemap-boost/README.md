# codemap-boost — 自动维护代码结构图

让 Claude 的代码搜索能力从「纯文本 grep」升级为「符号 + 调用关系」级别的图谱检索。

依赖准备好后，hook 会在后台自动构建和更新图谱；依赖安装与 MCP 注册需要先运行 `/codemap-boost-setup`。

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

此外还有轻量运行时提示 hook，会在 Claude 使用 Grep / Agent 时提醒它优先调用图谱 MCP 工具；该提示不落盘。

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
