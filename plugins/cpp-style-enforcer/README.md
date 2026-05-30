# cpp-style-enforcer

C++ 代码风格强制插件，基于 **Google C++ Style Guide + 现代 C++ 规范**。通过 hook 在编辑 / 提交时自动执行格式化、版权头、规范检查与编码统一，并区分新老项目采用不同策略。

## 功能简介

- **clang-format**：按 `.clang-format` 规则格式化（无配置回退 Google 风格），仅格式化改动行。
- **copyright**：自动插入 / 更新版权头，信息可配置、字段可缺省。
- **cpplint**：内嵌 cpplint.py 跑 Google C++ Style 检查，违规拦截编辑；`git commit` 前再查一遍暂存区。
- **UTF-8 BOM**：把 C/C++ 文件统一为带 BOM 的 UTF-8（GBK 自动转码）。

## 工作原理

| Hook 时机 | 脚本 | 作用 |
|---|---|---|
| SessionStart | `cpp_style_guard.js` | 检测 C++ 项目；缺配置时提示选模式；确保用户模板存在 |
| PostToolUse（Write/Edit/Bash/MCP） | `post_edit_pipeline.js` | 串行：clang-format → BOM → copyright → cpplint |
| PreToolUse（Bash） | `pre_commit_lint.js` | 拦截 `git commit`，对暂存区 C++ 文件跑 cpplint |

三件套（clang-format + copyright + cpplint）是否作用于某文件，由项目根目录的 `.claude-cpp-style` 决定；BOM 独立于模式。

## 新老项目行为对照

| 检查项 | full（新项目） | incremental 新文件 | incremental 旧文件 |
|---|:---:|:---:|:---:|
| clang-format | ✓ | ✓ | ✗ |
| copyright | ✓ | ✓ | ✗ |
| cpplint | ✓ | ✓ | ✗ |
| BOM | ✓ | ✓ | ✓ |

- **full**：所有 C/C++ 文件全量强制。
- **incremental**：以 `baseline` commit 为界，之后**新增**的文件走三件套；基线时已存在的旧文件只补 BOM。
- 旧文件判定：`git cat-file -e <baseline>:<相对路径>` 成功 = 旧文件。

（上表前提是对应 `checks` 开关为 true；copyright 列还要求 `copyrightInfo.company` 非空。）

## 配置：.claude-cpp-style

放在项目根目录（与 `.git` 同级），建议加入 `.gitignore`。全字段：

```json
{
  "mode": "full | incremental",
  "baseline": "<git commit hash>",
  "checks": {
    "clangFormat": true,
    "copyright": true,
    "cpplint": true,
    "bom": true
  },
  "copyrightInfo": {
    "company": "Your Company",
    "author": "you@example.com",
    "dateFormat": "YYYY/MM/DD HH:mm"
  }
}
```

| 字段 | 说明 |
|---|---|
| `mode` | `full` 全量 / `incremental` 仅新文件（必填） |
| `baseline` | incremental 必填，新旧文件分界 commit（钩子自动填 HEAD，勿手改） |
| `checks.clangFormat` | 是否格式化 |
| `checks.copyright` | 是否写版权头 |
| `checks.cpplint` | 是否 cpplint 拦截 |
| `checks.bom` | 是否补 BOM（独立于 mode，对所有文件生效） |
| `copyrightInfo.company` | 归属。**空 = 整个版权头不写**，cpplint 同步屏蔽 legal/copyright |
| `copyrightInfo.author` | 作者。空 = 不写 Author 行 |
| `copyrightInfo.dateFormat` | 日期格式（当前固定 `YYYY/MM/DD HH:mm`，预留） |

各 `checks` 缺失字段默认 `true`。`copyrightInfo` 各字段「有什么写什么，没有就不写那行」。

## 开关联动

- `copyright=false` **或** `company` 为空 → 实际不写版权头，cpplint 自动屏蔽 `legal/copyright`，不会因缺头误拦。
- BOM 受 `checks.bom` 控制，对所有文件生效（含 incremental 旧文件）。

## 模板继承机制

版权信息无需逐项目重填：

- 用户级模板：`~/.claude/cpp-style-template.json`，插件首次 SessionStart 时从出厂默认复制生成。
- 新项目首次被检测时，写入的 `.claude-cpp-style` 内容（`checks` + `copyrightInfo`）**继承自用户模板**，只覆盖 `mode` / `baseline`。
- 因此：把公司名 / 作者填进用户模板**一次**，之后所有新项目自动继承。
- 优先级：项目 `.claude-cpp-style` 的 `copyrightInfo` > 用户模板。

## 安装

### 通过 marketplace（推荐）

```
/plugin marketplace add IBinary6/claude-toolshop
/plugin install cpp-style-enforcer@claude-toolshop
```

安装后重启 Claude Code。打开 C++ 项目时按提示选择模式即可。

### 手动安装

见 [docs/MANUAL_INSTALL.md](docs/MANUAL_INSTALL.md)。

## 依赖

| 依赖 | 必需 | 用途 |
|---|---|---|
| Node.js 18+ | 是 | hook 运行时 |
| Python 3 | cpplint 需要 | 跑内嵌 cpplint.py（缺失则静默跳过 lint） |
| clang-format | clangFormat 需要 | 格式化（缺失则跳过格式化） |

依赖缺失时对应步骤静默降级，不报错、不阻塞。

## 命令

- `/cpp-style-setup` — 手动配置 / 重置当前项目模式，或查看 / 编辑用户模板。

## 许可

MIT
