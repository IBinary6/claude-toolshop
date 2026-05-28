# claude-toolshop

为 Claude Code 增强本地工程能力的插件集合（Plugin Marketplace）。

claude-toolshop 提供一组可独立安装的插件，通过 Hook、Skill、Command 等机制深度集成到 Claude Code 工作流中，提升编码、调试、构建等环节的效率。所有插件数据存储在本地，无需外部服务。

## 安装

### 前置依赖

| 依赖 | 最低版本 | 检测命令 |
|------|---------|----------|
| Python | 3.11+ | `python --version` |
| Node.js | 18+ | `node --version` |
| pip | — | `python -m pip --version` |

`python` 和 `node` 必须在 **PATH** 上能直接调起。Windows 用户注意：Windows Store 的 `python.exe` 是引导 stub 而非真 Python；卸载残留可能留下 `0xffffffff` 的失效 shim。`/bugdb-setup` 会先做这套环境检测，不满足会停下提示，不会盲装。

未装 Python 3.11+ 时任选：

- Windows：`scoop install python` / `winget install Python.Python.3.11` / [python.org](https://www.python.org/downloads/)（勾选 "Add Python to PATH"）
- macOS：`brew install python@3.11`
- Linux：发行版包管理器或 `pyenv install 3.11`

### 步骤

在 Claude Code 中**逐条**执行（每条独立按回车，不要一次性粘贴多行斜杠命令）：

```
/plugin marketplace add IBinary6/claude-toolshop
```

```
/plugin install bugdb-knowledge@claude-toolshop
```

```
/bugdb-setup
```

> 第三步 `/bugdb-setup` 会执行 `pip install -e` 安装 Python 依赖，并向 `~/.claude/CLAUDE.md` 追加触发规则，是插件正常工作的必要步骤，不可省略。

> **手动安装**：如果无法使用 Plugin Marketplace，参见 [plugins/bugdb-knowledge/docs/MANUAL_INSTALL.md](./plugins/bugdb-knowledge/docs/MANUAL_INSTALL.md)。

## 安装后的使用

装完三步即生效，无需额外配置。日常使用分两种入口：

### 自动入口（推荐）

不需要记任何命令。下面这些场景 Claude 会**自动**查/录知识库：

- 你粘贴了任何编译 / 链接 / 运行时错误（如 `error C2065`、`LNK2001`、`ModuleNotFoundError`、`segfault`）→ 自动查库
- 你说"搞定了 / 终于跑通 / 解决了 / 定下来了"等表达成功完成的语句 → 自动录库（去重后录入）
- Bash 跑命令后 stdout / stderr 出现错误 → Hook 把历史方案塞进上下文给 Claude 参考

### 手动入口（slash 命令）

| 命令 | 用法 | 何时用 |
|------|------|--------|
| `/bugsearch <错误或关键词>` | `/bugsearch LNK2001 ws2_32` | 想直接查知识库，不进入对话排查 |
| `/bugfix` | 无参数，交互式问答 | 想手动录入一条知识（如不依赖错误现场的工具技巧） |
| `/bugdb-setup` | 无参数 | 仅首次安装或换机时跑一次 |

`/bugsearch` 支持高级参数：`--language c++`（限定语言）、`--include-deprecated`（包含废弃记录），直接透传给 CLI。

### 升级

仓库发布新版后：

```
/plugin marketplace update claude-toolshop
```

然后**完全退出 Claude Code 再打开**——skill / hook 元数据只在启动时加载，仅 `git pull` 不会生效。

## 插件列表

| 插件 | 简介 |
|------|------|
| [bugdb-knowledge](./plugins/bugdb-knowledge) | 本地 Bug 知识库：SQLite + FTS5，Hook 自动查询，Skill 标准化录入 |

## 协议

MIT
