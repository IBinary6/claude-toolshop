# codemap-pro

**CodeGraph 智能维护插件** - 基于 tree-sitter + SQLite 的代码结构图谱，支持 20+ 语言，零网络请求。

## 特性

- ✅ **自动初始化** - SessionStart 检测并自动构建代码图谱
- ✅ **显式 setup** - 首次使用前安装 `codegraph` CLI + MCP Server 配置
- ✅ **增量更新** - CodeGraph 内置文件监听（2s 去抖）为主，PostToolUse 兜底 `sync`
- ✅ **Worktree 支持** - 自动处理 worktree 环境
- ✅ **Grep 软引导** - 运行时提示优先使用 CodeGraph MCP 工具，不写持久 MD 提示词
- ✅ **互斥建议** - 建议与 codemap-boost 二选一，避免重复图谱 hook 和重复引导

## 技术栈对比

| 特性 | codemap-boost | codemap-pro |
|------|---------------|-------------|
| 引擎 | code-review-graph (Python) | CodeGraph (Node.js) |
| 解析器 | Git diff-based | tree-sitter AST |
| 语言支持 | 有限 | 20+ 语言 |
| 增量更新 | Git diff | OS 文件监听 + 2s 去抖 |
| MCP Server | 外部依赖 | 内置 |
| 数据库 | `.code-review-graph/graph.db` | `.codegraph/codegraph.db` |

## 安装

### 方式 1：setup 安装（推荐）

插件不会在 hook 中自动安装 `codegraph` CLI。首次使用前运行 setup：
1. 安装插件
2. 运行 `/codemap-pro-setup`
3. 按提示安装 `codegraph` CLI 并注册 MCP
4. 重启 Claude Code，让 MCP Server 和 hook 元数据刷新

### 方式 2：手动预安装

```bash
# 全局安装 codegraph
npm install -g @colbymchenry/codegraph

# 手动预装时也需要显式配置 MCP Server
codegraph install --target=claude --yes
```

## 使用

安装后，插件会在 SessionStart 时：
1. 检测 `.codegraph/codegraph.db` 是否存在
2. 不存在 → 后台构建图谱（`codegraph init -i`）
3. 存在 → 依赖 MCP Server 的 auto-sync 增量更新

编辑文件或运行 Bash 后，`cg_sync` 会做兜底同步：已有 `.codegraph/codegraph.db` 时后台 `codegraph sync`，缺失时后台 `codegraph init -i`。

### 可用的 MCP 工具

在 Claude Code 中可以使用以下工具：
- `mcp__codegraph__context <task>` - 构建入口点上下文
- `mcp__codegraph__trace <symbol>` - 追踪调用路径
- `mcp__codegraph__callers <symbol>` - 查找调用者
- `mcp__codegraph__callees <symbol>` - 查找被调用者
- `mcp__codegraph__impact <symbol>` - 分析变更影响
- `mcp__codegraph__explore <query>` - 发现相关代码

### Grep 软引导

每次使用 `Grep` 工具时，插件会提示优先使用 CodeGraph MCP 工具（不阻塞 Grep）。

## 与 codemap-boost 的区别

**建议不要同时安装** - 两个插件都会维护图谱并在 Grep/Agent 时提供运行时引导，同时安装会重复触发 hook。

### 选择建议

- **codemap-boost** - Python 栈项目，轻量级，快速原型
- **codemap-pro** - 多语言大型项目，精确分析，生产级

### 从 codemap-boost 迁移

1. 卸载 codemap-boost
2. 安装 codemap-pro
3. 重启 Claude Code

## 支持的语言

TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C, C++, Objective-C, Swift, Kotlin, Scala, Dart, Lua, Luau, Svelte, Vue, Liquid, Pascal/Delphi

## 工作原理

### Hook 流程

```
SessionStart
└── cg_init.js (async)
    ├── 检测 codegraph CLI 可用性
    ├── 检测 .codegraph/codegraph.db
    └── 不存在 → 后台 init -i (detached + lock)

PreToolUse:Grep
└── grep_nudge.js
    └── 注入 additionalContext（软引导，不阻塞）

PostToolUse:Edit|Write|Bash
└── cg_sync.js (async)
    ├── .codegraph/codegraph.db 存在 → 后台 sync
    └── 不存在 → 后台 init -i

EnterWorktree
└── cg_worktree.js (async)
    ├── 检测 .codegraph/codegraph.db
    ├── 不存在 → 后台 init -i
    └── 存在 → 后台 sync
```

### setup 安装流程

1. **检测** - `ensure_deps.js` 检测 `codegraph` CLI
2. **安装** - setup 中经用户确认后执行 `npm install -g @colbymchenry/codegraph`
3. **配置 MCP** - setup 中执行 `codegraph install --target=claude --yes`
4. **写入配置** - CodeGraph CLI 写入 `~/.claude.json` 的 `mcpServers`
5. **后续运行** - CLI 已在 PATH 后，hook 自动 init/sync，不再重复 setup

### 锁机制

- 使用 `sha1(cwd).slice(0,16)` 命名锁文件
- 锁文件位置：`/tmp/codegraph-build-<cwd-hash>.lock`
- PID + mtime 双重陈旧检测（4小时超时）
- `flag: 'wx'` 原子获锁（防 TOCTOU 竞态）

## 配置

### 环境变量

- `CLAUDE_PLUGIN_DATA` - 持久数据目录（失败标记存储位置）
- `CLAUDE_WORKING_DIRECTORY` - 工作目录（worktree 场景）

### 日志

构建日志位于 `.codegraph/logs/`:
- `init-<timestamp>.log` - 初始化日志
- `init-posttool-<timestamp>.log` - 编辑后兜底初始化日志
- `sync-posttool-<timestamp>.log` - 编辑后兜底同步日志
- `init-worktree-<timestamp>.log` - Worktree 初始化日志
- `sync-worktree-<timestamp>.log` - Worktree 同步日志

## 故障排除

### codegraph 未安装或 PATH 未刷新

**症状**：SessionStart 无反应，`.codegraph/` 目录不存在

**解决**：
```bash
# 手动安装
npm install -g @colbymchenry/codegraph

# 配置 MCP
codegraph install --target=claude --yes

# 删除失败标记
# 重启 Claude Code
```

### 图谱构建卡住

**症状**：`.codegraph/codegraph.db` 一直不出现

**解决**：
```bash
# 检查构建日志
cat .codegraph/logs/init-*.log

# 手动构建
cd <project-root>
codegraph init -i

# 清除陈旧锁
rm /tmp/codegraph-build-*.lock
```

### 与 codemap-boost 重复运行

**症状**：Grep/Agent 运行时提示重复，或两个图谱目录都在后台更新

**解决**：
1. 只保留一个插件
2. 重启 Claude Code

### MCP 工具不可用

**症状**：`mcp__codegraph__*` 工具调用失败

**解决**：
```bash
# 检查 MCP 配置
cat ~/.claude.json | grep codegraph

# 应该看到：
# "codegraph": {
#   "type": "stdio",
#   "command": "codegraph",
#   "args": ["serve", "--mcp"]
# }

# 手动配置
codegraph install --target=claude --yes

# 重启 Claude Code
```

## 卸载

### 1. 移除插件
```bash
/plugin uninstall codemap-pro@claude-toolshop
```
然后完全退出并重启 Claude Code。

### 2. 清理 MCP 配置（重要）

否则重启后 Claude Code 会尝试启动已失效的 MCP Server。

编辑 `~/.claude.json`，删除 `mcpServers` 下的 `"codegraph"` 条目：

```json
{
  "mcpServers": {
    "codegraph": {  // 删除整个 codegraph 条目
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

或使用 codegraph CLI 反注册（如果支持）：
```bash
codegraph uninstall
```

### 3. 清理旧版 CLAUDE.md 提示规则

当前版本不再写入 `CLAUDE.md` / `AGENTS.md`。如果你安装过旧版，可删除 `~/.claude/CLAUDE.md` 中标记为 `<!-- codemap-pro-snippet-v1 -->` 的历史片段。

### 4. （可选）清理残留标记与缓存

```bash
# 删除失败标记
rm -f ~/.claude/plugins/data/*/codegraph-install-failed
# 或
rm -f /tmp/.codegraph-install-failed

# 清理构建锁（临时文件，重启自动清理）
rm -f /tmp/codegraph-build-*.lock
```

### 5. （可选）卸载 npm 包与项目图谱

```bash
# 卸载全局 codegraph CLI
npm uninstall -g @colbymchenry/codegraph

# 删除各项目的图谱目录（已被 .gitignore，不影响仓库）
rm -rf <project-root>/.codegraph/
```

**注意**：项目级的 `.codegraph/` 目录可以保留，不影响其他项目或工具使用。

---

## 常见问题

**Q：为什么还有 PostToolUse hook？**
A：CodeGraph MCP Server 内置文件监听（2s 去抖）是主路径；PostToolUse 只做兜底同步，并通过锁避免频繁重复任务。

**Q：如何确认图谱是否构建成功？**
A：检查 `.codegraph/codegraph.db` 文件是否存在，或运行 `codegraph status`。

**Q：为什么 setup 安装需要这么久？**
A：首次安装需要下载依赖（约 20-30MB），并编译 tree-sitter 解析器。安装完成后后续会话不需要重复 setup。

**Q：支持 monorepo 吗？**
A：支持。每个子项目独立初始化图谱。

## 性能

基于 CodeGraph 官方基准测试（7 个开源项目）：
- 平均节省 **25% 成本、57% token、23% 时间、62% 工具调用**
- **零文件读取** - 多数查询直接从图谱返回答案

## 开发

### 测试

```bash
# 测试依赖检测 helper
node -e "console.log(require('./hooks/js/lib/ensure_deps').ensureCodegraph())"

# 测试初始化
node hooks/js/cg_init/cg_init.js

# 测试 Grep 软引导
node hooks/js/grep_nudge/grep_nudge.js
```

### 调试

设置环境变量查看详细日志：
```bash
export DEBUG=codegraph:*
```

## 参考资料

- [CodeGraph GitHub](https://github.com/colbymchenry/codegraph)
- [CodeGraph 文档](https://github.com/colbymchenry/codegraph#readme)
- [Claude Code 插件开发](https://docs.anthropic.com/claude-code/plugins)

## 许可证

MIT License

## 作者

IBinary6
