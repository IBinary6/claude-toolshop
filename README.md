# claude-toolshop

IBinary6 的 Claude Code 插件市场（Plugin Marketplace）—— 一组可独立安装、增强本地工程能力的插件。所有插件数据存储在本地，无需外部服务。

## 前置依赖

通用环境：**Node.js 18+**、**Python**（pip 通常随 Python 自带）。各插件对版本和工具的具体要求不同，详见各自 README：

- **cpp-style-enforcer**：Python + Node.js + clang-format
- **bugdb-knowledge**：Python 3.11+
- **codemap-boost**：Python ≥ 3.10

## 安装

先添加 marketplace（只需一次）：

```
/plugin marketplace add IBinary6/claude-toolshop
```

然后按需安装下表中的插件。每个插件的安装命令、用法与前置条件详见各自 README。

## 插件索引

| 插件 | 功能 | 文档 |
|------|------|------|
| cpp-style-enforcer | C++ Google 风格强制（clang-format / cpplint / 版权头 / BOM），新老项目自动分流 | [README](./plugins/cpp-style-enforcer/README.md) |
| bugdb-knowledge | 本地 Bug 知识库，编辑/报错时自动召回历史 Bug 方案 | [README](./plugins/bugdb-knowledge/README.md) |
| codemap-boost | 代码图谱增强（code-review-graph / graphify hook 增强） | [README](./plugins/codemap-boost/README.md) |

## 协议

MIT
