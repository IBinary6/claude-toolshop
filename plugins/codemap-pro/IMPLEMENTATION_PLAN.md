# codemap-pro 插件实施计划

## 概述

**codemap-pro** 是基于 [CodeGraph](https://github.com/colbymchenry/codegraph) 的智能代码图谱维护插件，提供比 codemap-boost 更强大的代码分析能力。

### 技术栈对比

| 特性 | codemap-boost | codemap-pro |
|------|---------------|-------------|
| 引擎 | code-review-graph (Python) | CodeGraph (Node.js) |
| 解析器 | Git diff-based | tree-sitter AST |
| 数据库 | `.code-review-graph/graph.db` | `.codegraph/codegraph.db` |
| 语言支持 | 有限 | 20+ 语言 |
| 增量更新 | Git diff | OS 文件监听 + 2s 去抖 |
| MCP Server | 外部依赖 | 内置 |

### 设计原则

1. **与 codemap-boost 互斥** - 两个插件不能同时安装（CLAUDE.md 冲突）
2. **依赖 MCP 内置 auto-sync** - PostToolUse 不主动触发 sync（避免与 watcher 冲突）
3. **失败静默降级** - 所有 hook 永远 exit 0，不阻塞会话
4. **npm/npx 双路自举** - 优先全局 CLI，回退 npx 零安装

---

## 目录结构

```
codemap-pro/
├── .claude-plugin/
│   └── plugin.json              # 插件元信息
├── hooks/
│   ├── hooks.json               # Hook 配置
│   └── js/
│       ├── lib/
│       │   ├── utils.js         # 跨平台工具库（从 codemap-boost 复制）
│       │   └── ensure_deps.js   # npm/npx 自举
│       ├── cg_init/
│       │   └── cg_init.js       # SessionStart - 智能初始化
│       ├── cg_worktree/
│       │   └── cg_worktree.js   # EnterWorktree - worktree 处理
│       └── claudemd_inject/
│           └── claudemd_inject.js # SessionStart - 提示注入
└── README.md
```

**关键变更**：
- **移除 `cg_sync/cg_sync.js`** - 依赖 MCP 内置 auto-sync，不需要 PostToolUse hook
- **简化 hooks.json** - 只保留 SessionStart + EnterWorktree

---

## Hook 流程设计

### 1. SessionStart Hook

```
claudemd_inject.js (同步，5s 超时)
    ↓
检测 codemap-boost 是否存在
    ↓
    存在 → 跳过注入（防冲突）
    不存在 → 注入/更新 CLAUDE.md

cg_init.js (async=true，10s 超时)
    ↓
检测 codegraph CLI 可用性
    ↓
    不可用 → 后台预热安装 (detached)
    ↓
检测 .codegraph/codegraph.db
    ↓
    不存在 → 后台 `codegraph init -i` (detached + lock)
    存在 → 静默跳过（或 sync 补离线改动）
```

### 2. EnterWorktree Hook

```
cg_worktree.js (async=true，10s 超时)
    ↓
检测 .codegraph/codegraph.db
    ↓
    不存在 → 后台 `codegraph init -i`
    存在 → 后台 `codegraph sync`
```

### 3. PostToolUse Hook - 移除

**理由**：CodeGraph MCP Server 内置文件监听（2s 去抖），自动增量同步。PostToolUse 主动 sync 会：
- 与 MCP watcher 产生写竞争
- 增加进程开销
- 用户体验无明显提升

**兜底方案**：SessionStart 时 sync 一次，补齐会话间的离线改动。

---

## 核心脚本实现要点

### lib/utils.js
- **完全复制** codemap-boost 的 utils.js
- 无需修改，跨平台工具库可直接复用

### lib/ensure_deps.js
- 参考 codemap-boost 的 pip 自举模式
- 改为 npm/npx 自举：
  1. 检测全局 `codegraph` CLI（`which codegraph` / `where codegraph`）
  2. 不存在 → 尝试 `npx @colbymchenry/codegraph --version`（零安装）
  3. 都失败 → 写失败标记 `.codegraph-install-failed`，提示用户手动安装
- **关键**：探测用 `spawnSync(cmd, ['--version'], {stdio: 'ignore', timeout: 15000})`
- **关键**：失败标记落 `CLAUDE_PLUGIN_DATA` 而非插件目录

### cg_init.js
- 前置门禁：CLI 可用 + Git 仓库
- 锁机制：`sha1(cwd).slice(0,16)` + `flag: 'wx'` + PID+mtime 检测
- 状态检测：
  - `.codegraph/codegraph.db` 不存在 → 获取锁，后台 `codegraph init -i`
  - 存在 → 跳过（或 `codegraph sync` 补离线改动）
- 后台任务：wrapper 进程包裹 + finally 释放锁

### cg_worktree.js
- 与 cg_init 逻辑类似
- 区别：worktree 环境下必须重新检测（`CLAUDE_WORKING_DIRECTORY` 变化）
- 决策矩阵：
  - DB 不存在 → `init -i`
  - DB 存在 → `sync`（增量更新）

### claudemd_inject.js
- 版本化幂等注入（`codemap-pro-snippet-v1`）
- **互斥检测**：搜索 `codemap-boost-snippet` → 存在则跳过注入
- 注入内容：引导 Claude 优先使用 CodeGraph MCP 工具
- 同时触发依赖预热：`require('../lib/ensure_deps').spawnPrewarm()`

---

## MCP Server 集成

CodeGraph 内置 MCP Server，**无需插件配置**。

### 用户侧操作

1. **安装 CodeGraph**：
   ```bash
   npm install -g @colbymchenry/codegraph
   ```

2. **配置 MCP**（首次）：
   ```bash
   codegraph install --target=claude --yes
   ```
   自动写入 `~/.claude.json`：
   ```json
   {
     "mcpServers": {
       "codegraph": {
         "type": "stdio",
         "command": "codegraph",
         "args": ["serve", "--mcp"]
       }
     }
   }
   ```

3. **重启 Claude Code** - 加载 MCP Server

### 插件侧职责

- **只负责项目级初始化**：SessionStart 时 `init -i`
- **不管理 MCP Server 生命周期** - 由 CodeGraph 自身管理

---

## CLAUDE.md 互斥机制

### 问题
codemap-boost 和 codemap-pro 都向 `~/.claude/CLAUDE.md` 注入提示规则，会产生冲突。

### 解决方案
在 `claudemd_inject.js` 中：
```js
// 检测对方插件
const existing = fs.readFileSync(target, 'utf-8');
if (existing.includes('codemap-boost-snippet')) {
  // codemap-boost 已安装，跳过注入
  console.error('[codemap-pro] 检测到 codemap-boost，跳过注入（两个插件不能同时使用）');
  return;
}

// 检测自己是否已是最新版本
if (existing.includes('codemap-pro-snippet-v1')) {
  return; // 已是最新，跳过
}

// 注入/更新提示规则
// ...
```

### 用户引导
在 README.md 中明确说明：
> **注意**：codemap-boost 和 codemap-pro 不能同时安装。请根据项目规模选择：
> - **codemap-boost** - Python 栈，轻量级
> - **codemap-pro** - Node.js 栈，支持 20+ 语言，更强大

---

## hooks.json 配置

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/claudemd_inject/claudemd_inject.js\"",
            "timeout": 5
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_init/cg_init.js\"",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "EnterWorktree": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/cg_worktree/cg_worktree.js\"",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  }
}
```

**移除的 hook**：
- ~~PostToolUse (Edit|Write|Bash)~~ - 依赖 MCP 内置 auto-sync

---

## 实施优先级

### Phase 1 - 核心框架（当前任务）
- [x] 创建目录结构
- [x] 编写 plugin.json
- [x] 编写 hooks.json
- [ ] 复制 lib/utils.js（完全复用 codemap-boost）
- [ ] 编写 lib/ensure_deps.js（npm/npx 自举）
- [ ] 编写 cg_init.js（SessionStart 初始化）
- [ ] 编写 claudemd_inject.js（提示注入 + 互斥检测）

### Phase 2 - Worktree 支持
- [ ] 编写 cg_worktree.js

### Phase 3 - 文档与测试
- [ ] 编写 README.md（安装指南、使用说明、FAQ）
- [ ] 手动测试（冷启动、worktree、互斥检测）
- [ ] 版本发布（v0.1.0）

---

## 测试场景

### 1. 冷启动测试
1. 删除 `.codegraph/`
2. 启动 Claude Code 会话
3. 验证：后台 `codegraph init -i` 触发
4. 验证：CLAUDE.md 注入成功

### 2. 热启动测试
1. `.codegraph/codegraph.db` 已存在
2. 启动会话
3. 验证：跳过初始化，或 sync 补离线改动

### 3. 互斥测试
1. 安装 codemap-boost
2. 安装 codemap-pro
3. 启动会话
4. 验证：codemap-pro 跳过 CLAUDE.md 注入
5. 验证：终端输出提示信息

### 4. Worktree 测试
1. 进入 worktree
2. 验证：检测 DB → `init -i` 或 `sync`

### 5. 失败降级测试
1. 卸载 codegraph CLI
2. 启动会话
3. 验证：失败标记写入，不阻塞会话

---

## 常见问题（FAQ）

**Q：为什么移除了 PostToolUse hook？**
A：CodeGraph MCP Server 内置文件监听（2s 去抖），自动增量同步。PostToolUse 主动 sync 会产生写竞争，且无明显收益。

**Q：如何确认 MCP Server 是否运行？**
A：运行 `codegraph status`，或在 Claude Code 中尝试调用 `mcp__codegraph__*` 工具。

**Q：codemap-boost 和 codemap-pro 能同时安装吗？**
A：不能。两个插件会在 CLAUDE.md 中冲突。请根据项目需求二选一。

**Q：如何切换到 codemap-pro？**
A：
1. 卸载 codemap-boost
2. 删除 CLAUDE.md 中的 `codemap-boost-snippet` 段落
3. 安装 codemap-pro
4. 运行 `codegraph install --target=claude --yes`
5. 重启 Claude Code

---

## 参考资料

- [CodeGraph GitHub](https://github.com/colbymchenry/codegraph)
- [codemap-boost 实现分析](./codemap-boost-analysis.md)
- [Claude Code 插件开发指南](https://docs.anthropic.com/claude-code/plugins)
