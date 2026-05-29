# codemap-boost — 自动维护代码结构图

让 Claude 的代码搜索能力从「纯文本 grep」升级为「符号 + 调用关系」级别的图谱检索。

装上即用，跟知识库一样在后台默默工作，**无需手动操作**。

---

## 前置依赖

| 依赖 | 安装 |
|------|------|
| Node.js 18+ | `winget install OpenJS.NodeJS.LTS` / `brew install node` / `apt install nodejs` |
| `code-review-graph` CLI | `pip install code-review-graph` |
| `graphify` CLI | `pip install graphify` |

三者**全部必需**，缺任一项对应 hook 不会工作。

装插件后跑一次 `/codemap-boost-setup` 即可——它会逐项检测，缺哪个就**问你要不要直接帮你装**：`code-review-graph` / `graphify` 这两个 pip 包同意后可自动安装；Node.js 因需管理员权限只打印命令让你复制（**不会替你跑 sudo / winget**）。

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

第三步会检测前置依赖、缺失时问你是否代装，并确认 hook 文件完好。CLAUDE.md 触发规则会在首次 SessionStart 自动追加。

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

此外还有一个轻量提示 hook，会在 Claude 每次用 Grep 时提醒它优先调用图谱 MCP 工具。

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
