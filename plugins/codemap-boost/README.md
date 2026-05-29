# codemap-boost — 自动维护代码结构图

让 Claude 的代码搜索能力从「纯文本 grep」升级为「符号 + 调用关系」级别的图谱检索。

装上即用，跟知识库一样在后台默默工作，**无需手动操作**。

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

装完即生效，CLAUDE.md 触发规则会在首次 SessionStart 自动追加。

如果想确认前置依赖是否齐全，可以再跑一次：

```
/codemap-boost-setup
```

它只做检测——逐项告诉你 Node / CRG / graphify 是否在 PATH 上，缺哪个就打印对应的安装命令（**不会替你跑 sudo / pip**）。

#### 升级

```
/plugin marketplace update claude-toolshop
```

然后**完全退出 Claude Code 再打开**——hook / command 元数据只在启动时加载，必须重启才能生效。

### 方式二：手动安装

详见 [docs/MANUAL_INSTALL.md](./docs/MANUAL_INSTALL.md)。

---

## 前置依赖

| 依赖 | 安装 |
|------|------|
| Node.js 18+ | `winget install OpenJS.NodeJS.LTS` / `brew install node` / `apt install nodejs` |
| `code-review-graph` CLI | `pip install code-review-graph` |
| `graphify` CLI | `pip install graphify` |

三者**全部必需**，缺任一项对应 hook 不会工作。`/codemap-boost-setup` 会检测并打印缺失项的安装命令。

---

## 它能做什么？

提供两个自动化能力，让你**不用再手动维护代码结构图**：

| 能力 | 触发时机 | 你不用做的事 |
|------|---------|-------------|
| **自动构建** | 打开会话时 | 手动跑 `code-review-graph build` / `graphify .` |
| **增量更新** | 改完文件后 | 手动跑 `code-review-graph update` |

此外还有一个轻量提示 hook，会在 Claude 第一次想用 Grep 时**温柔提醒**它优先调用图谱 MCP 工具（每会话只提示一次）。

> 装上之后该干啥干啥，图谱会跟着你的代码自动刷新。

---

## 卸载

```
/plugin uninstall codemap-boost@claude-toolshop
```

重启 Claude Code。

---

## 协议

MIT
