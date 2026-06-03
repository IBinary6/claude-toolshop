---
description: 查看或配置 cpp-style-enforcer：编辑全局模板或为当前项目写覆盖配置
---

# cpp-style-enforcer 配置

本命令是**按需配置工具**，纯查看与编辑配置，不做任何交互式提问或拦截。根据需要选择以下操作之一。

## 配置层级

1. **全局模板** `~/.claude/cpp-style-template.json`：所有项目的默认值（公司名、作者、默认 mode、各检查开关）。SessionStart 首次自动创建，**已存在绝不覆盖**。
2. **项目覆盖** `<项目根>/.claude-cpp-style/cpp-style.json`：对当前项目做**字段级覆盖**（只写想改的字段，其余回退全局模板）。注意是 `.claude-cpp-style` 文件夹内的 `cpp-style.json` 文件。

## Schema（两层同构）

```json
{
  "enabled": true,
  "mode": "incremental",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "legacyChecks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": true },
  "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

- `enabled`：设为 false 彻底关闭本项目所有检查。
- `mode`：`incremental`（仅新文件走全套）| `full`（所有文件走全套）。
- `checks.clangFormat`：格式化（含 #include 排序）；`checks.cpplint`：Google C++ 风格静态检查；`checks.copyright`：版权头；`checks.bom`：UTF-8 BOM 补全（CMake 项目自动跳过）。
- `legacyChecks.*`：`incremental` 下老文件的检查项，默认只开 `bom`，即只补 UTF-8 BOM。
- `copyrightInfo.company`：空 = 不写版权头，cpplint 同步屏蔽 legal/copyright；`copyrightInfo.author`：作者名；`copyrightInfo.dateFormat`：当前时间显示格式，占位符 `YYYY`/`MM`/`DD`/`HH`/`mm`。

## 常见操作

- 设公司名/作者（全局）：编辑 `~/.claude/cpp-style-template.json` 的 `copyrightInfo.company` / `copyrightInfo.author`。
- 某项目关闭：项目根 `.claude-cpp-style/cpp-style.json` 写 `{ "enabled": false }`。
- 新项目要求所有文件规范：写 `{ "mode": "full" }`。
- 只要 BOM：写 `{ "checks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": true } }`。

## 行为速记

- **新老文件判定** = 文件是否已在 `HEAD` 中存在。`incremental` 下未提交过的新文件走全套，老文件默认只补 BOM。非 git 仓库所有文件视为新文件走全套。
- **CMake 项目**（从被编辑文件向上找到 CMakeLists.txt）一律不补 BOM，其余检查照常。
- **dateFormat** 是当前时间的显示格式模板，必须含 `YYYY`/`MM`/`DD`，否则回退默认 `YYYY/MM/DD HH:mm`；同日不重复刷新 Date 行。
- **局部豁免** include 排序：源码里用 `// clang-format off` / `// clang-format on` 包住。
