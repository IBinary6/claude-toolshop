# cpp-style-enforcer

C++ 代码风格强制插件，基于 **Google C++ Style Guide**。通过 Claude Code hook 在本轮编辑结束 / 提交时自动执行格式化、版权头、cpplint 检查、行尾与 UTF-8 BOM 统一，并区分新老文件采用不同策略。

## 与 Codex 版的语义对应

两边执行同一套 C++ 规范语义：**编辑时只记录、本轮结束统一处理；新文件/新项目走全套，已跟踪老文件默认保持原编码和格式；Visual Studio 源工程保持 CRLF；提交前 cpplint 只读 Git index、不改写工作区；第三方目录不格式化、不 lint**。

| 语义能力 | Claude Code 版 | Codex 版 |
|---|---|---|
| 编辑后处理 | `PostToolUse` 只记录触碰的 C++ 文件；主 Agent 在 `Stop`、子代理在各自的 `SubagentStop` 统一处理 | `PostToolUse` 记录，`Stop` 按 turn 批量处理 |
| 待处理分桶 | `session_id` + `agent_id`（Claude 无 turn_id；子代理编辑归子代理自己收尾） | `session_id` + `turn_id` |
| 提交前检查 | `PreToolUse:Bash/PowerShell` 识别真正的 `git commit`，对 Git index 快照跑 cpplint | `PreToolUse:Bash`，同样基于 index 快照 |
| 项目配置 | `.claude-cpp-style/cpp-style.json` + `~/.claude/cpp-style-template.json` | `.codex-cpp-style/`，兼容 `.claude-cpp-style/` |
| 依赖安装 | 运行期只检测，不自动 `pip/npm install` | 同左 |

## 工作原理

| Hook 时机 | 脚本 | 作用 |
|---|---|---|
| SessionStart | `hooks/js/session_start.js` | 仅确保全局模板存在（首次复制出厂默认，已存在绝不覆盖）；**不写任何项目文件** |
| PostToolUse（内置编辑 / Agentic Patch / MCP 批量补丁） | `hooks/js/post_edit.js` | 只记录本次触碰的 C++ 文件到 `CLAUDE_PLUGIN_DATA`，不改写文件，失败的工具结果不记录 |
| Stop / SubagentStop | `hooks/js/stop_check.js` | 逐文件：clang-format → BOM（仅新文件）→ copyright → 行尾 → cpplint；有改写或违规时 `decision:block` 一次，要求复查最终 diff 并重跑验证 |
| PreToolUse（Bash / PowerShell） | `hooks/js/pre_commit.js` | 识别 `git`/`git.exe`/绝对路径/`cmd /c`/PowerShell `&` 调用，只对真正的 `git commit` 检查暂存区 C++ 文件 |

为什么延迟到 Stop：编辑之间改写文件会让 Claude 后续 `Edit` 因“文件已被修改”失败并反复重读；统一收尾还避免同一文件被多次格式化。格式化可能改变 include 顺序，因此收尾后会要求重新运行相关构建/测试。

- `stop_hook_active=true`（上次 block 后的续跑）时只用 `systemMessage` 告知用户，不再 block，避免循环。
- 收尾有 45s 内部截止；超时未处理的文件放回队列由下一次结束时处理，并在报告中列为未检查，不会静默丢弃。
- `CLAUDE_PLUGIN_DATA` 缺失（手动安装）时待处理记录写系统临时目录，不写插件根。

> 去交互：装上即默认启用，不弹问选模式。某项目可用 `enabled:false` 关闭。

## 配置

两层同构，项目层对全局层做**字段级覆盖**：

1. **全局模板** `~/.claude/cpp-style-template.json`：所有项目默认值（SessionStart 首次创建，**已存在绝不覆盖**）。
2. **项目覆盖** `<项目根>/.claude-cpp-style/cpp-style.json`：只写想改的字段，其余回退全局模板。首次在该项目实际处理 C++ 文件时按需生成，并自动加入 `.gitignore`。

Schema：

```json
{
  "enabled": true,
  "mode": "incremental",
  "lineEnding": "preserve",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "legacyChecks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": false },
  "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | 设 `false` 彻底关闭本项目所有处理（完全 no-op，文件零改动） |
| `mode` | `incremental`（仅新文件走全套）/ `full`（所有文件走全套；已跟踪文件仍保持原 BOM 状态） |
| `lineEnding` | `preserve`（默认，按正文占多数的行尾）/ `lf` / `crlf`。Visual Studio 源工程始终 CRLF |
| `checks.clangFormat` | 格式化（新文件整文件；VS 源工程保留 `#include` 顺序） |
| `checks.copyright` | 版权头。`company` 为空 = 不写头，cpplint 同步屏蔽 `legal/copyright` |
| `checks.cpplint` | cpplint 风格检查（违规在本轮结束时要求修复 / 阻止提交） |
| `checks.bom` | 新文件补 UTF-8 BOM；已跟踪文件不改编码 |
| `legacyChecks.*` | `incremental` 下老文件（已在 HEAD 中存在）使用的检查项，默认全部关闭；`bom` 仅保留兼容 |
| `copyrightInfo.dateFormat` | 当前时间的**显示格式**（占位符 `YYYY/MM/DD/HH/mm`） |

各 `checks` 缺失字段默认 `true`；各 `legacyChecks` 缺失时默认 `false`。配置损坏或缺失时回退硬编码安全默认，绝不崩。旧全局模板里的 `legacyChecks.bom: true` 不会再给已跟踪文件加 BOM。

## 三档行为（新老判定 = 是否已在 HEAD 中存在）

| 场景 | 行为 |
|---|---|
| 新项目 / `mode:full` | 全套：clang-format + 版权头 + cpplint；新文件补 BOM |
| 老项目新文件（未在 HEAD 中存在，含未跟踪或已 `git add` 未提交） | 同样全套（整文件格式化 + BOM） |
| 老项目老文件（`incremental` 且已在 HEAD 中存在） | 默认保持原编码、BOM 与格式；只做基础行尾修复 |

非 git 仓库下所有文件视为「新」。cpplint 的 header guard 根目录依次取 Git 根、包含该文件的会话 cwd、文件所在目录，不会生成含机器绝对路径的宏名。

## 要点

- **clang-format**：新文件整文件格式化（`-style=file -fallback-style=Google`）。老文件只有显式 `legacyChecks.clangFormat:true` 时才仅格式化 git 改动行，并读取项目 `.clang-format`（`--sort-includes=false`），不再用内联 Google 风格覆盖项目缩进。
- **Visual Studio 源工程**（祖先目录有 `.sln`/`.slnx`/`.vcxproj`，且最近一级没有 `CMakeLists.txt`）：保留依赖敏感的 `#include` 顺序，cpplint 同步屏蔽 `build/include_order`；行尾强制 CRLF，包括已被误改成 LF 的文件。CMake 生成的 VS 文件不算原生 VS 工程。
- **行尾**：独立于 clang-format 与 legacyChecks；只替换换行字节、补齐同种末尾换行，保留编码与 BOM，UTF-16 按原编码处理，不改 Git 暂存区。
- **自动生成 `.clang-format`**：走全套且项目根及其父目录都没有 `.clang-format`/`_clang-format` 时，生成一份 `BasedOnStyle: Google`。父目录已有配置时不生成，避免遮盖继承的风格；已存在绝不覆盖，非 git 项目不生成。
- **版权头**：字段级幂等，已有 Copyright/Author/Date/路径行保留原文，缺失才补；文件前 25 行已有外来格式版权/许可证（`/* */`、SPDX、`(c)` 等）时不叠加标准头。Date 一旦写入不再刷新。
- **cpplint**：随附 `cpplint.py` 以 `utf-8-sig` 读取，直接忽略 BOM，检查过程**从不写文件**（mtime、BOM、行尾全不变）。Python/cpplint 不可用、超时、读不到配置时报告 `runtime/*` 条目，不冒充零违规。
  - **软违规**：`build/header_guard` 与 `build/include_subdir` 为建议性提示，其余为硬违规。
- **提交前检查**：用 `git diff --cached -z` 列出暂存文件（保留空格、中文、特殊字符），把这些文件和 index 中全部 `CPPLINT.cfg` 写入临时快照再检查，**以暂存内容为准**而不是工作区；无法枚举暂存区、无法建立或清理快照、检查异常时**拒绝提交**并说明原因。
- **第三方目录**：按完整目录段排除 `3rd`、`3rdparty`、`third_party`、`third-party`、`thirdpart`、常见错拼 `thridpart`/`thridparty`、`vendor`、`external`、`deps`、`packages`、构建产物目录等；目录名只是包含这些子串（如 `vendor_manager`）不排除。
- **局部豁免** `#include` 排序：源码用 `// clang-format off` / `// clang-format on` 包住。
- **协议安全**：全程 `exit 0`，stdout 要么空、要么单个 JSON。

## 依赖

**前提：用户须自备 Python 3 + Node.js**（插件不代装这两者）。运行期只检测依赖，不在 hook 中自动执行 `npm install` 或 `pip install`。

| 依赖 | 必需 | 用途 | 说明 |
|---|---|---|---|
| Node.js 18+ | 是 | hook 运行时 | 用户自备 |
| Python 3 | 是 | 跑内嵌 `cpplint.py`；`python -m clang_format` | 探测顺序：Windows `py -3` → `python` → `python3`；macOS/Linux `python3` → `python`；逐个验证确为 Python 3。可用 `CPP_STYLE_PYTHON` / `CPP_STYLE_PYTHON_ARGS` 指定 |
| cpplint | 内置 | C++ 风格检查 | 内嵌 `hooks/js/cpplint/cpplint.py` |
| clang-format | 格式化需要 | 格式化 | 支持 PATH / `python -m clang_format` / Python Scripts 目录；缺失则跳过格式化 |
| `iconv-lite` | GBK 文件需要 | GBK→UTF-8 转码 | 缺失则 GBK 文件跳过 BOM（不转码、不损坏） |

- **手动预热可用**：`node hooks/js/lib/ensure_deps.js --prewarm` 尝试补齐可选依赖；普通 hook 路径不会自动安装。
- **不污染插件缓存**：失败标记与待处理记录写 `CLAUDE_PLUGIN_DATA`，缺失时写系统临时目录，不写 marketplace 插件根。

## 命令

- `/cpp-style-setup` — 查看 / 编辑全局模板，或为当前项目写覆盖配置。

## 安装

### 通过 marketplace（推荐）

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install cpp-style-enforcer@claude-toolshop
```

安装后重启 Claude Code，默认即生效。

### 手动安装

见 [docs/MANUAL_INSTALL.md](docs/MANUAL_INSTALL.md)。

## 验证

```bash
npm test
claude plugin validate --strict .
```

## 许可

MIT
