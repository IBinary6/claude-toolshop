# Claude Toolshop

`claude-toolshop` 是 IBinary6 的 Claude Code 插件市场，集中维护本地工程工作流插件。插件默认在本机运行，数据保存在用户目录或项目目录，不依赖外部服务。

## 快速安装

在 Claude Code 中先添加 marketplace，只需执行一次：

```text
/plugin marketplace add IBinary6/claude-toolshop
```

然后按需安装插件：

```text
/plugin install agent-dispatch@claude-toolshop
/plugin install bugdb-knowledge@claude-toolshop
/plugin install codemap-boost@claude-toolshop
/plugin install cpp-style-enforcer@claude-toolshop
```

安装或升级插件后，完全退出 Claude Code 再打开。Claude Code 的 hook、command 和 skill 元数据在启动时加载，重启后才会使用新版本。

## 插件索引

| 插件 | 当前用途 | 日常用法 |
| --- | --- | --- |
| `agent-dispatch` | Claude 原生插件 subagents 与任务级路由：opus 规划与审查、sonnet 写代码、haiku 读代码/日志/搜索/研究/测试。 | 安装后自动创建配置骨架；SessionStart、UserPromptSubmit 和 subagent 生命周期 hook 协同工作，子代理不得运行 Git。 |
| `bugdb-knowledge` | 本地 Bug 知识库，Shell 输出或用户粘贴的错误行命中时只读召回历史解决方案。 | 安装后正常工作；召回不会创建或迁移数据库；需要手动查询时使用插件命令。 |
| `codemap-boost` | 内置 `code-review-graph` 与 Serena（插件私有环境，自带 MCP），可选 `graphify`。 | 安装后首次会话自动后台安装，装好后 `/mcp` 重连；之后自动维护图谱，无需 pip 或另行注册 MCP。 |
| `cpp-style-enforcer` | Google C++ 风格流程：clang-format、cpplint、行尾、BOM 和提交前检查（插件内文本与提示全部为英文）。 | 编辑时只记录，本轮结束（Stop/SubagentStop）统一处理；已跟踪文件默认保持原编码和格式。 |

## 推荐使用顺序

1. 添加 marketplace。
2. 安装需要的插件。
3. 完全重启 Claude Code；首次会话 codemap-boost 在后台安装内置的 code-review-graph 与 Serena，装好后运行 `/mcp` 重连（排障用 `/codemap-boost-setup`）。
4. 在项目中正常提问、编辑、提交；hook 会在后台维护图谱和风格检查。

## CodeMap Boost 怎么用

`codemap-boost` 自带 `.mcp.json`，code-review-graph 与 Serena 装在插件私有环境（`CLAUDE_PLUGIN_DATA`），不需要全局 pip，也不要再在 cc-switch 或 `~/.claude.json` 里注册同名 MCP。运行后：

- `SessionStart` 会检查 `.code-review-graph/`，缺失或空图时后台 build。
- `PostToolUse` 会在编辑或 Bash 后低频触发 `code-review-graph update`。
- `CwdChanged` 会在切换工作目录或 worktree 后维护对应仓库图谱。
- `PreToolUse:Grep` 和 `PreToolUse:Agent` 会提示优先使用图谱 MCP 工具，不阻塞原工具。
- 可选 `graphify` 只在安装后启用，用于更高层知识图谱。

常用检查：

```bash
node "<插件目录>/scripts/ensure-runtime.cjs" --doctor
```

## C++ Style 怎么用

`cpp-style-enforcer` 安装后会自动处理 C/C++ 编辑流程：

- `SessionStart` 只准备全局模板，不写项目文件。
- `PostToolUse` 只记录本轮编辑的 C/C++ 文件；`Stop`/`SubagentStop` 统一执行格式化、BOM（仅新文件）、行尾和 cpplint。
- `PreToolUse:Bash` 识别真正的 `git commit`，对暂存区 C++ 文件做提交前检查。

全局模板通常在：

```text
~/.claude/cpp-style-template.json
```

项目级配置通常在：

```text
.claude-cpp-style/cpp-style.json
```

## 更新本地插件

从远程 marketplace 更新：

```text
/plugin marketplace update claude-toolshop
/plugin update agent-dispatch@claude-toolshop
/plugin update bugdb-knowledge@claude-toolshop
/plugin update codemap-boost@claude-toolshop
/plugin update cpp-style-enforcer@claude-toolshop
```

更新完成后完全重启 Claude Code。

## 前置依赖

- Node.js 18+：所有 Node hook 都需要。
- Python：`bugdb-knowledge`、`codemap-boost`、`cpp-style-enforcer` 的部分能力需要。
- Python 3.11+：推荐给 `bugdb-knowledge`。
- Python 3.10+：推荐给 `code-review-graph`。
- `clang-format`：可选；缺失时 C++ 格式化跳过，其他检查继续。

## 故障排查

- hook 行为没有变化：先确认已经完全重启 Claude Code。
- CodeMap 没有图谱：运行 `/codemap-boost-setup`，再检查 `code-review-graph status`。
- C++ 提交被拦截：按 hook 输出修复暂存区 C++ 文件，再重新 `git add` 和 `git commit`。
- 子代理调度过严：查看或调整 `.agent-dispatch/config.json`。

## 协议

MIT
