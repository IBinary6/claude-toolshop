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
| `agent-dispatch` | 主 agent 工具白名单和子代理调度，避免复杂任务挤爆上下文。 | 安装后自动创建配置骨架；遇到被拦截的高风险/大任务操作时，按提示改用 Agent。 |
| `bugdb-knowledge` | 本地 Bug 知识库，编辑或报错时召回历史解决方案。 | 安装后正常工作；需要手动查询时使用插件命令，知识库存储在本机。 |
| `codemap-boost` | 基于 `code-review-graph` 和可选 `graphify` 的代码结构图增强。 | 首次运行 `/codemap-boost-setup` 准备依赖；之后 SessionStart/PostToolUse 自动 build/update。 |
| `cpp-style-enforcer` | 团队 C++ 风格流程：clang-format、cpplint、版权头、BOM 和提交前检查。 | 正常编辑 C/C++ 文件即可；提交前 hook 会检查暂存区 C++ 文件。 |

## 推荐使用顺序

1. 添加 marketplace。
2. 安装需要的插件。
3. 对 CodeMap 运行一次 setup：

```text
/codemap-boost-setup
```

4. 完全重启 Claude Code。
5. 在项目中正常提问、编辑、提交；hook 会在后台维护图谱和风格检查。

## CodeMap Boost 怎么用

`codemap-boost` 的依赖安装和 MCP 注册通过 `/codemap-boost-setup` 完成。setup 完成后：

- `SessionStart` 会检查 `.code-review-graph/`，缺失或空图时后台 build。
- `PostToolUse` 会在编辑或 Bash 后低频触发 `code-review-graph update`。
- `CwdChanged` 会在切换工作目录或 worktree 后维护对应仓库图谱。
- `PreToolUse:Grep` 和 `PreToolUse:Agent` 会提示优先使用图谱 MCP 工具，不阻塞原工具。
- 可选 `graphify` 只在安装后启用，用于更高层知识图谱。

常用检查：

```bash
code-review-graph --version
code-review-graph status
```

## C++ Style 怎么用

`cpp-style-enforcer` 安装后会自动处理 C/C++ 编辑流程：

- `SessionStart` 准备全局和项目配置。
- `PostToolUse` 对 C/C++ 写入执行格式化、BOM、版权头和 cpplint。
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
