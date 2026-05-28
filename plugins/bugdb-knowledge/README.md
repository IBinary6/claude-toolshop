# bugdb-knowledge

本地 Bug 知识库插件 -- 基于 SQLite + FTS5 全文检索，为 Claude Code 提供错误诊断的持久化经验积累。

Bash 命令报错时 Hook 自动查询知识库；Skill 提供标准化的查询/录入流程；Command 供手动触发。所有数据存储在本地，无需外部服务。

## 功能概述

- **自动查询**：PostToolUse Hook 监听 Bash 工具输出，检测到错误时自动查询知识库
- **全文检索**：SQLite FTS5 支持模糊匹配，错误消息经归一化后匹配历史方案
- **经验积累**：解决 bug 后录入知识库，下次遇到相同问题直接复用方案
- **置信度评分**：搜索结果按相关性排序，feedback 机制持续优化方案质量

## 安装

通过 Plugin Marketplace 安装：

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install bugdb-knowledge@claude-toolshop
```

手动安装参见 [INSTALL.md](./INSTALL.md)。

## 提供的功能

### Skills

| Skill | 用途 |
|-------|------|
| `bugdb-lookup` | 遇到编译/链接/运行时/构建错误时，查询知识库获取历史方案 |
| `bugdb-record` | 将已解决的 bug 按规范录入知识库，含去重检查 |

### Commands

| 命令 | 用途 |
|------|------|
| `/bugfix` | 交互式录入 Bug 知识库 |
| `/bugsearch` | 直接查询 Bug 知识库 |

### Hook

`PostToolUse:Bash` -- 当 Bash 工具执行完毕且输出包含错误特征时，自动调用 `bugdb search` 查询匹配方案。无需手动触发。

### CLI 子命令

通过 `python cli.py <subcommand>` 调用，所有外部调用方（Hook/Skill/Command）统一经此入口：

| 子命令 | 说明 |
|--------|------|
| `search` | 搜索 bug 记录 |
| `add` | 录入新记录 |
| `get` | 按 ID 查询单条记录 |
| `list` | 列出记录 |
| `update` | 更新已有记录 |
| `delete` | 删除记录（默认软删除） |
| `restore` | 恢复软删除记录 |
| `feedback` | 反馈方案有效性 |
| `deprecate` | 标记记录为废弃 |
| `obsolete` | 标记记录为方案不可用 |
| `find-similar` | 录入前查找相似记录 |
| `normalize` | 对错误消息做归一化 |
| `export` | 全量导出到 JSON 文件 |
| `import` | 从 JSON 文件批量导入 |
| `config` | 查看/修改 BugDB 配置 |
| `stats` | 数据库统计信息 |

默认输出 JSON，`--format text` 切换为人类可读格式。

## 数据存储

默认路径 `~/.claude/bugdb/`，包含：

| 文件 | 说明 |
|------|------|
| `bugs.db` | SQLite 数据库（含 FTS5 索引） |
| `bugdb.log` | 操作日志 |
| `config.json` | 可选配置文件 |

### BUGDB_HOME 环境变量

设置 `BUGDB_HOME` 可将数据存储到自定义目录。路径解析优先级：

1. `BUGDB_HOME` 环境变量
2. `~/.claude/bugdb/config.json` 中的 `db_path` / `log_path`
3. 默认 `~/.claude/bugdb/`

## 协议

MIT
