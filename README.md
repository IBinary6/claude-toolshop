# claude-toolshop

为 Claude Code 增强本地工程能力的插件集合（Plugin Marketplace）。

claude-toolshop 提供一组可独立安装的插件，通过 Hook、Skill、Command 等机制深度集成到 Claude Code 工作流中，提升编码、调试、构建等环节的效率。所有插件数据存储在本地，无需外部服务。

## 安装

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

## 插件列表

| 插件 | 简介 |
|------|------|
| [bugdb-knowledge](./plugins/bugdb-knowledge) | 本地 Bug 知识库：SQLite + FTS5，Hook 自动查询，Skill 标准化录入 |

## 协议

MIT
