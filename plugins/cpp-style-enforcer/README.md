# cpp-style-enforcer

C++ 代码风格强制插件，基于 **Google C++ Style Guide**。通过 Claude Code hook 在编辑 / 提交时自动执行格式化、版权头、cpplint 检查与 UTF-8 BOM 统一，并区分新老文件采用不同策略。

## v0.3.0 行为

单进程模块化流水线，全程 `exit 0`（不再有协议冲突崩溃），cpplint 使用真实路径运行以避免 header guard / include order 误报，并保证源文件字节恢复。clang-format 双模式（新文件整文件全格 / 老文件仅格改动行），运行期只检测依赖、不做网络安装，并按需自动生成项目 `.clang-format` 让 VS / clangd / 本插件三方一致。

### 工作原理

| Hook 时机 | 脚本 | 作用 |
|---|---|---|
| SessionStart | `hooks/js/session_start.js` | 完全静默，仅确保全局模板存在（首次复制出厂默认，已存在绝不覆盖） |
| PostToolUse（Write/Edit/MultiEdit/NotebookEdit/MCP） | `hooks/js/post_edit.js` | 单进程串行：clang-format → BOM → copyright → cpplint |
| PreToolUse（Bash） | `hooks/js/pre_commit.js` | 仅拦截真正的 `git commit`，对暂存区 C++ 文件跑 cpplint |

> 去交互：装上即默认启用，不再弹问选模式。某项目可用 `enabled:false` 关闭。

### 配置

两层同构，项目层对全局层做**字段级覆盖**：

1. **全局模板** `~/.claude/cpp-style-template.json`：所有项目默认值（SessionStart 首次创建，**已存在绝不覆盖**）。
2. **项目覆盖** `<项目根>/.claude-cpp-style/cpp-style.json`（**文件夹** `.claude-cpp-style/` 下的 `cpp-style.json`）：只写想改的字段，其余回退全局模板。

Schema：

```json
{
  "enabled": true,
  "mode": "incremental",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "legacyChecks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": true },
  "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | 设 `false` 彻底关闭本项目所有检查（完全 no-op，文件零改动） |
| `mode` | `incremental`（仅新文件走全套）/ `full`（所有文件走全套） |
| `checks.clangFormat` | 格式化（新文件整文件全格含 `#include` 排序；老文件仅格改动行、include 不动） |
| `checks.copyright` | 版权头。`company` 为空 = 不写头，cpplint 同步屏蔽 `legal/copyright` |
| `checks.cpplint` | cpplint 风格检查（违规拦截编辑 / 阻止提交） |
| `checks.bom` | 补 UTF-8 BOM（CMake 项目自动跳过） |
| `legacyChecks.*` | `incremental` 下老文件（已在 HEAD 中存在）使用的检查项，默认只开 `bom` |
| `copyrightInfo.dateFormat` | 当前时间的**显示格式**（占位符 `YYYY/MM/DD/HH/mm`） |

各 `checks` 缺失字段默认 `true`；各 `legacyChecks` 缺失时默认 `clangFormat/copyright/cpplint=false`、`bom=true`。配置损坏或缺失时回退硬编码安全默认，绝不崩。

### 三档行为（新老判定 = 是否已在 HEAD 中存在）

| 场景 | 行为 |
|---|---|
| 新项目 / `mode:full` | 所有文件全套：clang-format（**整文件全格，含 `#include` 排序**）+ 版权头 + cpplint + BOM |
| 老项目新文件（`incremental` 且**未在 HEAD 中存在**，包含未跟踪或已 `git add` 但未提交的文件） | 同样全套（整文件全格） |
| 老项目老文件（`incremental` 且**已在 HEAD 中存在**） | 默认**只补 UTF-8 BOM**（无 BOM 则补 BOM）；**不 format / 不版权 / 不 lint** |

非 git 仓库下所有文件视为「新」（走全套，整文件格式化）。

### 要点

- **clang-format 双模式**：走全套的文件**整文件格式化**（`-style=file -fallback-style=Google`，`#include` 正常排序）。老项目老文件默认不格式化；只有显式设置 `legacyChecks.clangFormat:true` 时，才仅格式化 git 改动行（`--lines` + 内联 `SortIncludes:Never`，include 永不被动排序）。
- **自动生成 `.clang-format`**：走全套且项目根（git 根）缺 `.clang-format`（或 `_clang-format`）时，自动生成一份 `BasedOnStyle: Google`——让 **VS 2017+ / clangd / 本插件**三方读同一份配置，风格一致不打架。**已存在绝不覆盖，非 git 项目不生成**。老文件「不排 include」靠插件调用时内联 `SortIncludes:Never`，**不写进**项目 `.clang-format`，故不影响新文件 / VS 的正常排序。
- **CMake 项目**（从文件向上找到 `CMakeLists.txt`）一律**不补 BOM**，其余检查照常。
- **dateFormat** 是当前时间显示格式模板：必须含 `YYYY`+`MM`+`DD`，否则回退默认 `YYYY/MM/DD HH:mm`；同日不重复刷新 Date 行。
- **cpplint** 使用真实路径运行，确保 header guard / include order 仍按真实文件名判断；无 BOM 文件零写入，有 BOM 文件仅在检查期间临时剥 BOM 并在 `finally` 中恢复原始字节。CRLF/LF 不作为 cpplint 规避项，检查后保持原行尾。
  - **软违规**：`build/header_guard` 与 `build/include_subdir` 为建议性提示（非强制 block）——可改用 `#pragma once` / 完整目录前缀，也可按项目习惯保留。其余为硬违规，强制修复。
  - filter 精简：新架构下走全套文件先 Google 整文件格式化再 lint，format 已对齐 Google，故无需旧的 `include_order` / `indent_namespace` / `comments` filter；仅按需屏蔽 `legal/copyright`。
- **局部豁免** `#include` 排序：源码用 `// clang-format off` / `// clang-format on` 包住。
- **协议安全**：全程 `exit 0`，stdout 要么空、要么纯 JSON，绝不崩溃、不阻塞会话。
- **去交互**：不再弹问选模式，`/cpp-style-setup` 为按需配置工具。

## 依赖

**前提：用户须自备 Python 3 + Node.js**（插件不代装这两者）。运行期只检测依赖，不在 SessionStart / PostToolUse 中自动执行 `npm install` 或 `pip install`，避免编辑 hook 被网络安装阻塞或超时。

| 依赖 | 必需 | 用途 | 自举方式 |
|---|---|---|---|
| Node.js 18+ | 是（前提） | hook 运行时 | 用户自备 |
| Python 3 | 是（前提） | 跑内嵌 `cpplint.py`；clang-format 的 pip 安装与 `python -m clang_format` 调用也靠它 | 用户自备 |
| cpplint | 内置 | C++ 风格检查 | 内嵌 `cpplint/cpplint.py`，靠 Python 运行，无需安装 |
| clang-format | 格式化需要 | 格式化 | 检测支持 PATH / `python -m clang_format` / Python Scripts 目录三种调用方式；缺失则静默跳过格式化 |
| `iconv-lite` | GBK 文件需要 | GBK→UTF-8 转码 | 缺失则 GBK 文件跳过 BOM（不转码、不损坏） |

- **手动预热可用**：如需让插件尝试补齐可选依赖，可手动运行 `node hooks/js/lib/ensure_deps.js --prewarm`；普通 hook 路径不会自动安装。
- **不污染插件缓存**：失败标记优先写 `CLAUDE_PLUGIN_DATA`，缺失时写系统临时目录，不写 marketplace 插件根，避免 update 时因运行时文件导致工作树变脏。
- **编辑期只检测不安装**：PostToolUse 流水线只检测可用性，不在编辑时同步安装（避免阻塞编辑）。
- 任一依赖缺失 → 对应步骤静默降级，不报错、不阻塞。

> **GBK 转码说明**：将 GBK 编码的 C/C++ 文件转为带 BOM 的 UTF-8 依赖 `iconv-lite`（已在 `package.json` 声明为 dependency）。若 `iconv-lite` 缺失，GBK 文件会被判为 `unknown` 并**跳过 BOM 处理**——文件不被转码、也**不被损坏**，其余非 GBK 文件不受影响。

## 命令

- `/cpp-style-setup` — 查看 / 编辑全局模板，或为当前项目写覆盖配置（按需配置工具，不弹问、不拦截）。

## 安装

### 通过 marketplace（推荐）

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install cpp-style-enforcer@claude-toolshop
```

安装后重启 Claude Code，默认即生效。

### 手动安装

见 [docs/MANUAL_INSTALL.md](docs/MANUAL_INSTALL.md)。

## 许可

MIT
