# cpp-style-enforcer

C++ 代码风格强制插件，基于 **Google C++ Style Guide**。通过 Claude Code hook 在编辑 / 提交时自动执行格式化、版权头、cpplint 检查与 UTF-8 BOM 统一，并区分新老文件采用不同策略。

## v0.3.0 行为

单进程模块化流水线，全程 `exit 0`（不再有协议冲突崩溃），cpplint 在临时副本上运行**不损坏源文件**。

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
  "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | 设 `false` 彻底关闭本项目所有检查（完全 no-op，文件零改动） |
| `mode` | `incremental`（仅新文件走全套）/ `full`（所有文件走全套） |
| `checks.clangFormat` | 格式化（含 `#include` 排序） |
| `checks.copyright` | 版权头。`company` 为空 = 不写头，cpplint 同步屏蔽 `legal/copyright` |
| `checks.cpplint` | cpplint 风格检查（违规拦截编辑 / 阻止提交） |
| `checks.bom` | 补 UTF-8 BOM（CMake 项目自动跳过） |
| `copyrightInfo.dateFormat` | 当前时间的**显示格式**（占位符 `YYYY/MM/DD/HH/mm`） |

各 `checks` 缺失字段默认 `true`；配置损坏或缺失时回退硬编码安全默认，绝不崩。

### 三档行为（新老判定 = git 是否跟踪）

| 场景 | 行为 |
|---|---|
| 新项目 / `mode:full` | 所有文件全套：clang-format（含 `#include` 排序）+ 版权头 + cpplint + BOM |
| 老项目新文件（`incremental` 且**未被 git 跟踪**） | 同样全套 |
| 老项目老文件（`incremental` 且**已被 git 跟踪**） | **只补 BOM**，不格式化 / 不版权 / 不 lint |

非 git 仓库下所有文件视为「新」（走全套）。

### 要点

- **CMake 项目**（从文件向上找到 `CMakeLists.txt`）一律**不补 BOM**，其余检查照常。
- **dateFormat** 是当前时间显示格式模板：必须含 `YYYY`+`MM`+`DD`，否则回退默认 `YYYY/MM/DD HH:mm`；同日不重复刷新 Date 行。
- **cpplint** 在 `os.tmpdir()` 下的临时副本上运行，**永不写回原文件**，仅产出违规报告（去重后取前 5 条）。
- **局部豁免** `#include` 排序：源码用 `// clang-format off` / `// clang-format on` 包住。
- **去交互**：不再弹问选模式，`/cpp-style-setup` 为按需配置工具。

## 依赖

| 依赖 | 必需 | 用途 |
|---|---|---|
| Node.js 18+ | 是 | hook 运行时 |
| Python 3 | cpplint 需要 | 跑内嵌 `cpplint.py`（缺失则静默跳过 lint） |
| clang-format | clangFormat 需要 | 格式化（缺失则静默跳过格式化） |
| `iconv-lite` | GBK 文件需要 | GBK→UTF-8 转码（见下） |

依赖缺失时对应步骤静默降级，不报错、不阻塞。

> **GBK 转码说明**：将 GBK 编码的 C/C++ 文件转为带 BOM 的 UTF-8 依赖 `iconv-lite`（已在 `package.json` 声明为 dependency）。若运行环境**缺失 `iconv-lite`**，GBK 文件会被判为 `unknown` 并**跳过 BOM 处理**——文件不被转码、也**不被损坏**，其余非 GBK 文件不受影响。

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
