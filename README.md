# claude-toolshop

为 Claude Code 增强本地工程能力的插件集合（Plugin Marketplace）。

claude-toolshop 提供一组可独立安装的插件，通过 Hook、Skill、Command 等机制深度集成到 Claude Code 工作流中，提升编码、调试、构建等环节的效率。所有插件数据存储在本地，无需外部服务。

## 安装

在 Claude Code 中执行：

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install bugdb-knowledge@claude-toolshop
```

> **手动安装**：如果无法使用 Plugin Marketplace，每个插件目录下的 `INSTALL.md` 提供了手动部署步骤。参见 [bugdb-knowledge/INSTALL.md](./plugins/bugdb-knowledge/INSTALL.md)。

## 插件列表

| 插件 | 简介 |
|------|------|
| [bugdb-knowledge](./plugins/bugdb-knowledge) | 本地 Bug 知识库：SQLite + FTS5，Hook 自动查询，Skill 标准化录入 |

## 协议

MIT
