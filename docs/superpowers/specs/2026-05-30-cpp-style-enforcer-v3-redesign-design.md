# cpp-style-enforcer v0.3.0 全新重构设计

> 状态：待用户审阅
> 日期：2026-05-30
> 性质：**全新设计，零向后兼容**。不读取旧 `.claude-cpp-style` 的遗留字段（如 `baseline`），不保留任何旧行为分支。

## 1. 背景与根因

### 1.1 崩溃根因（已用两个取证 agent 实测确认）

插件上传后用户反映「执行 hook（尤其 PostToolUse）时崩溃」。根因定位：

`post_edit_pipeline.js` 的 `mode===null` 兜底分支（项目未配置时），对**每次**编辑 C++ 文件
（甚至 Bash 命令字符串里出现 `.cpp` 字样）都执行：

```js
console.error(警告);
console.log(JSON.stringify({ decision: 'block', reason: ... })); // stdout JSON
process.exit(2);                                                  // 同时 exit 2
```

**两个致命问题：**

1. **协议冲突**：Claude Code 的 PostToolUse 协议规定——`exit 2` 时 **stdout 的 JSON 被完全丢弃，只读 stderr**；`decision:block` 的 JSON 必须配 `exit 0` 才生效。代码同时用了两条互斥通道，stdout JSON 是废的，行为不可预期。
2. **反复拦截卡死**：这是个对「未配置项目的每次编辑」都触发的 `block`，要求 Claude 用 AskUserQuestion 弹问选模式。在 Cloud / headless / 无人值守环境无法应答 → 持续 block → turn 配额耗尽、会话卡死。

辅助隐患（一并修复）：
- 主流水线 `spawnSync("node", 子脚本)` 串行起子进程跑 copyright/cpplint，最坏 clang-format(10s)+copyright(10s)+cpplint(15s)=35s **超过 PostToolUse 的 30s timeout**，慢环境超时被中止。
- cpplint「剥原文件 BOM → lint → finally 恢复」：进程被 timeout 杀掉时 finally 不保证执行，**用户源文件可能被永久剥掉 BOM 或半截损坏**。
- 多处 `console.log(JSON) + exit 2` 协议混用（cpplint_check.js / pre_commit）。

### 1.2 权威协议结论（取证 agent 查官方文档）

| Exit | stdout | stderr | 行为 |
|---|---|---|---|
| `0` | 合法 JSON 按协议解析 | 不读 | 正常 |
| `2` | **忽略** | 喂给 Claude | 工具已执行，stderr 作反馈 |
| `1`/其它 | — | 给用户 | **issue #4809：exit 1 在 PostToolUse 会阻塞会话** |

- PostToolUse 合法 stdout JSON：`{"decision":"block","reason":...}`（exit 0）。
- PreToolUse 阻止工具：`{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":...}}`（exit 0）。
- SessionStart：纯文本 stdout + exit 0 合法（作 context 注入）；不会把非 JSON 当 JSON 解析。
- timeout 单位**秒**；超时=非阻塞错误，会话继续。
- matcher 是对 `tool_name` 的大小写敏感正则。

## 2. 行为契约（最终锁定）

| 项 | 决定 |
|---|---|
| SessionStart | 保留但**完全静默**，只 `ensureUserTemplate()`，exit 0，无任何输出/检测/拦截 |
| 新老文件判定 | **git 是否跟踪**：`!isTracked(file)` = 新文件。无 baseline 概念 |
| cpplint 运行 | 在 `os.tmpdir` **临时副本**上跑，**cpplint 步骤不写回原文件**（进程被杀也不损坏源文件） |
| 输出协议 | 全程 exit 0；`blockClaude` 走 stdout JSON；诊断走 stderr；**永不** exit 1 / exit 2+stdout JSON |
| 配置来源 | 全局模板默认 ⊕ 项目字段级覆盖；缺失/损坏 → 用默认；`enabled:false` 彻底关闭 |
| 默认模式 | `incremental`（新文件走全套；老文件仍 clang-format 仅格改动行 + `SortIncludes:Never` + 补 BOM）；`full` 可选（所有文件整文件全格） |
| clang-format 双模式 | 全套文件**整文件全格**（include 正常排序）；老文件**仅格 git 改动行** + 内联 `SortIncludes:Never`（include 永不被动） |
| cpplint 违规 | **强制修复**：exit 0 + `decision:block` JSON 把违规清单喂给 Claude |
| 代码组织 | 单进程模块化流水线，**删除** spawn 子 node 进程链 |

## 3. 目录结构

```
hooks/
  hooks.json                     # 注册 3 个 hook
  js/
    post_edit.js                 # PostToolUse 入口（薄壳：读输入→编排→协议输出）
    pre_commit.js                # PreToolUse 入口（薄壳：git commit lint）
    session_start.js             # SessionStart 入口（薄壳：仅 ensureUserTemplate）
    lib/
      stdin.js                   # readStdinJson（带超时，防 stdin 不关闭挂死）
      protocol.js                # 唯一输出出口：passSilent / blockClaude / denyTool
      config.js                  # 配置解析：用户模板 ⊕ 项目覆盖 → 规范化配置对象
      git.js                     # repoRoot / isTracked / changedLineRanges
      project.js                 # findCMakeRoot（向上找 CMakeLists.txt，与 git 解耦）
      bom_util.js                # stripBom / restoreBom / detectEncoding —— BOM 字节处理唯一实现
      target.js                  # resolveFilePath / shouldHandle / 扩展名·排除目录常量
      ensure_deps.js             # 依赖自举：ensureIconvLite(npm) / ensureClangFormat(pip) / detectClangFormat / spawnPrewarm
      ensure_clang_format_config.js  # 走全套且项目根缺 .clang-format 时生成 BasedOnStyle: Google
    steps/
      clang_format.js            # 纯函数：剥BOM→格式化→diff→拼回BOM（复用 bom_util）
      bom.js                     # 纯函数：补 BOM / GBK 转码（复用 bom_util）
      copyright.js               # 纯函数：剥BOM→插/更头→拼回BOM（复用 bom_util），dateFormat 生效
      cpplint.js                 # 纯函数：临时副本 lint + 解析违规
    cpplint/cpplint.py           # 内嵌 cpplint（不动）
  templates/
    cpp-style-template.default.json
  commands/
    cpp-style-setup.md           # 重写：编辑全局模板 / 写项目覆盖，无弹问拦截
```

项目级配置形态：项目根目录下 **`.claude-cpp-style/` 文件夹**，内放 **`cpp-style.json`**：

```
<项目根>/
  .claude-cpp-style/
    cpp-style.json               # 项目级配置（字段级覆盖全局模板）
```

每文件单一职责、≤200 行。入口只做「读输入 → 编排 steps → 统一协议输出」，业务逻辑全在 `steps/` 和 `lib/`，可独立单测。

**最大结构改动**：copyright/cpplint 从「独立 hook 子进程」变为**同进程内纯函数调用**。消除重复读 stdin、重复 spawn node、35s>30s 超时。整个 PostToolUse 至多 spawn 一次 python（cpplint）+ 按需 spawn git/clang-format。

## 4. 配置模型

### 4.1 Schema（全局模板与项目配置同构）

```jsonc
{
  "enabled": true,            // 项目级可 false 彻底关闭；缺省 true
  "mode": "incremental",      // "incremental" | "full"；缺省 incremental
  "checks": {
    "clangFormat": true,
    "copyright": true,
    "cpplint": true,
    "bom": true
  },
  "copyrightInfo": {
    "company": "",            // 空 = 不写版权头，cpplint 同步屏蔽 legal/copyright
    "author": "",             // 空 = 不写 Author 行
    "dateFormat": "YYYY/MM/DD HH:mm"   // Date 行格式模板；占位符 YYYY/MM/DD/HH/mm；缺省即此值
  }
}
```

### 4.2 解析规则（`config.js`）

- 全局默认：`~/.claude/cpp-style-template.json`（SessionStart 首次安装时从出厂默认复制；**已存在则绝不覆盖**）。
- 项目覆盖：项目根 **`.claude-cpp-style/cpp-style.json`**（文件夹内的 JSON）做**字段级覆盖**（项目没写的字段回退全局模板；全局也没有则用硬编码安全默认）。
- `checks` 各字段缺失默认 `true`（安全默认：不少做检查）。
- 配置文件夹/文件不存在 / JSON 损坏 → 静默用默认值，**绝不崩、绝不拦截**。
- `enabled === false` → 整个流水线 `passSilent()` 跳过。
- 无 baseline 字段、无任何旧字段读取。

### 4.3 三档行为模型（核心）

新老判定在 `git.js`：`isNew(file) = !isTracked(file)`（git 未跟踪 = 新文件）。

| 场景 | 配置 | 行为 |
|---|---|---|
| **新项目** | `mode: full` | **所有文件强制全套**：clang-format（**整文件全格，含 #include 排序，必须规范**）+ 版权 + cpplint + BOM |
| **老项目·新文件** | `mode: incremental` 且 `!isTracked` | **同样强制全套**：整文件全格 + 版权 + cpplint + BOM（新写的代码就该规范，也修复问题） |
| **老项目·老文件** | `mode: incremental` 且 `isTracked` | **补 BOM + clang-format 仅格改动行**：缺 BOM 才补；clang-format 只格 git 改动行且 `SortIncludes:Never`（include 永不被动排序）；**版权/cpplint 一概不碰** |

- 非 git 仓库：所有文件视为「新」（走全套，整文件格式化）。
- `applyTriple = (mode==='full') || (mode==='incremental' && isNew(file))`。
- **关键决策（用户明确）—— clang-format 双模式**：
  - 走全套的文件（新项目所有文件 + 老项目新文件，即 `applyTriple` 为真）→ clang-format **整文件格式化**：`-style=file -fallback-style=Google`，**正常排序 #include**，必须规范。
  - 老项目老文件（`incremental` 且 `isTracked`）→ clang-format **仍会运行，但仅格 git 改动行**：取 `changedLineRanges` 传 `--lines=s:e`，并内联 `-style={BasedOnStyle: Google, SortIncludes: Never}` **强制 include 永不被排序**；无改动行则不格式化。即老文件现在也会被格式化（仅改动行对齐 Google），但**不加版权、不 lint、include 不动**。
  - 「include 不排序」靠**调用时内联 `SortIncludes:Never`**实现（仅作用于本插件这一次调用），**不写进项目 `.clang-format`**——故不影响新文件 / VS / clangd 对其它文件的正常 include 排序。
  - 因此**不需要 `--sort-includes=0` 命令行开关、不需要 sortIncludes 配置开关**——新老区分在「整文件全格」vs「仅改动行 + SortIncludes:Never」两种调用形态，而非单一排序参数。
  - **局部豁免**：用户若想让某段 #include 不被排，自行在源码里用 `// clang-format off` / `// clang-format on` 包住即可（clang-format/VS/clangd 都认），插件不参与。

#### 已知行为与限制（非 bug，明示避免困惑）
- **git add 会触发档位翻转**：incremental 模式下，新文件首次编辑（未跟踪）走全套、整文件格式化；用户 `git add` 后该文件变「已跟踪」，再次编辑即降级为「仅格改动行（`SortIncludes:Never`）+ 补 BOM，不再版权/lint」。这是 `!isTracked` 判定的自然结果，符合「存量代码不动」的意图。
- **复制改名的老代码会被当新文件**：从老文件 copy 改名而来、含大量旧代码的文件，git 视为未跟踪 = 新文件 → 整文件格式化 + include 重排。若不希望，先 `git add` 该文件再编辑，或临时用 `mode` 控制。属判定模型的固有边界。

### 4.4 CMake 项目检测（`lib/project.js`，与 git 解耦）

```
findCMakeRoot(filePath):
  从 path.dirname(filePath) 起逐级向上，直到文件系统根
  任一层目录存在 CMakeLists.txt → 返回该层目录（= CMake 项目根）
  到顶仍无 → 返回 null
isCMakeProject(filePath) = findCMakeRoot(filePath) !== null
```

- **不依赖 git root**：CMake 检测独立从被编辑文件向上找 `CMakeLists.txt`。这样**非 git 的 CMake 项目**（有 CMakeLists.txt 但未 git init，常见于项目初期）也能正确识别并跳过 BOM。若用 git root 判定，非 git 项目 root=null 会导致门控失效——已规避。
- **向上递归找**（非仅项目根单层）：覆盖"被编辑文件在子目录、CMakeLists.txt 在上层"的常规 CMake 布局。
- 结果**仅用于门控 BOM 步骤**：CMake 项目跳过 BOM，其余步骤（clang-format/copyright/cpplint）不受影响。
- 全程纯 `fs.existsSync`，对 null/不存在路径安全返回 false，不抛异常。
- 单次 hook 调用内缓存结果（每次 hook 是独立进程，缓存仅进程内有效）。

### 4.5 自动生成 `.clang-format`（`lib/ensure_clang_format_config.js`）

走全套流程（`applyTriple` 为真）且项目根缺 `.clang-format` 时，插件在**项目根（git 仓库根）**生成一份 Google 风格配置，让 **VS 2017+ / clangd / 本插件**三方读同一份配置 → 格式化风格一致、互不打架。

```
ensureClangFormatConfig(root):
  root 为 null（非 git）→ 不生成（无可靠项目根概念）
  项目根已存在 .clang-format 或 _clang-format（Windows 兼容名）→ 绝不覆盖，直接返回
  否则写 <root>/.clang-format，内容：
    # Generated by cpp-style-enforcer — Google C++ Style
    BasedOnStyle: Google
  写文件 UTF-8 无 BOM、LF；失败 try/catch 吞掉，不影响主流程
```

- **仅在 `applyTriple` 为真时调用**：新项目所有文件 / 老项目新文件首次编辑时触发生成；老文件仅格改动行的路径不触发。
- **绝不覆盖**已有 `.clang-format` / `_clang-format`，尊重用户既有配置。
- 老文件的「不排 include」**不写进**这份项目配置（靠调用时内联 `SortIncludes:Never`，见 §5），故生成的项目配置对新文件 / VS 仍是正常 Google 排序。

## 5. 执行流水线（PostToolUse）

`post_edit.js` 编排，每步独立 try/catch，单步失败跳过、不影响后续：

| 步骤 | 模块 | 执行条件（`enabled!==false` 为所有步骤的前置，enabled:false 时整体 passSilent） |
|---|---|---|
| 1. clang-format | `steps/clang_format.js` | `checks.clangFormat` 且 clang-format 可用（**所有文件都跑**：`applyTriple` → 整文件全格；老文件 → 仅格改动行 + `SortIncludes:Never`） |
| 2. BOM | `steps/bom.js` | `checks.bom && !isCMakeProject(filePath)`（**独立于 mode/applyTriple，所有文件**） |
| 3. copyright | `steps/copyright.js` | `applyTriple && checks.copyright` 且 `company` 非空 |
| 4. cpplint | `steps/cpplint.js` | `applyTriple && checks.cpplint` 且 python 可用 |

其中 `applyTriple = (mode==='full') || (mode==='incremental' && isNew(file))`。

#### 优先级层级（显式）

`enabled`（总开关，最高）＞ `mode`/`applyTriple`（决定三件套是否作用）＞ `checks.*`（各步子开关）。

- `enabled === false`：在进入流水线**之前**就 `passSilent()`，**BOM 也不执行**。「BOM 独立于 mode」仅指 mode/applyTriple 不门控 BOM；但 `enabled` 和 `checks.bom` 仍门控 BOM。
- 即：BOM 执行的完整条件 = `enabled !== false && checks.bom`（与 applyTriple/mode 无关）。

#### 文件改写术语约定（统一）

流水线四步**原地改写同一个磁盘文件**，后一步读到的是前一步处理后的结果。术语统一：
- 「原文件零改动」**仅**在 §6 cpplint 语境使用，特指 **cpplint 这一步不写回任何文件**（它在临时副本上 lint）。不指「文件从头到尾没被碰过」。
- 每步的 mtime/写入承诺见下表。

#### BOM 处理收敛（唯一实现，三步复用）

`lib/bom_util.js` 提供 `stripBom(buf)→{hadBom, body}` 与 `restoreBom(hadBom, bodyBuf)→buf`。**所有会原地改写文件的步骤（clang-format / copyright），写文件前一律：剥 BOM → 在无 BOM 正文上操作 → 按 `hadBom` 拼回 BOM**。BOM 字节处理只此一处实现，避免各步各写一套、行为漂移。

#### 各步说明

- **clang-format（双模式，所有文件都进此步）**：
  - **全套文件（`applyTriple`：新项目所有文件 / 老项目新文件）→ 整文件全格**：`-style=file -fallback-style=Google`，含 #include 排序。
  - **老项目老文件（`incremental` 且 `isTracked`）→ 仅格改动行**：取 `changedLineRanges(filePath, root)` 拼 `--lines=s:e`，并内联 `-style={BasedOnStyle: Google, SortIncludes: Never}` 强制 include 不排序；无改动行 → 不格式化返回 false。
  - **调用方式（内置 Google 兜底，不写项目 .clang-format）**：整文件模式用 `-style=file`。项目有 `.clang-format` → 读它（VS/clangd 同源一致）；没有且走全套 → 由 §4.5 在项目根**生成**一份 `BasedOnStyle: Google`（见下），再 `-style=file` 读到它。老文件「不排 include」靠**调用时内联** `SortIncludes:Never`，**不写进** 项目 `.clang-format`，不影响新文件 / VS 的正常排序。
  - 不传 `--sort-includes` 命令行开关（跨版本不可靠，无必要）。
  - clang-format 可用性由 `detectClangFormat`（PATH / `python -m clang_format` / python Scripts 目录三种调用方式）判定；编辑期只检测不安装（安装在 SessionStart 后台预热做，见 §9.1），检测不到 → 静默降级。
  - **BOM 感知（CRITICAL，与 copyright 同构）**：文件此时**可能已带 BOM**。流程：`读文件 → bom_util.stripBom → 对无 BOM 正文跑 clang-format(stdin/stdout) → 与无 BOM 正文 diff → 仅当有变化时按 bom_util.restoreBom(hadBom, formatted) 写回`。剥 BOM 只去文件最前 3 字节（不增减行），故 git diff 改动行号可直接用作 `--lines`。**绝不把带 BOM 字节直接喂给 clang-format**。
  - **省 token**：不用 `-i`；stdout→diff→仅变化才写回，无变化不刷 mtime。
- **BOM**：执行条件 = `enabled !== false && checks.bom && !isCMakeProject(filePath)`（**独立于 mode，所有文件**）。缺 BOM 才补/转码；**已有 UTF-8 BOM 则内容无变化、不写**。
  - **CMake 项目整体不补 BOM（用户明确）**：`isCMakeProject(filePath)`（从文件向上找 CMakeLists.txt，见 §4.4，与 git 解耦）为真 → **该文件跳过 BOM 步骤**（clang-format/版权/cpplint 照常）。理由：CMake 跨平台工具链（gcc/clang）下 BOM 可能引发编译问题。**注意**：CMake 项目里走 clang-format 的文件，其原有 BOM 由 clang-format 步骤的 strip/restore 保全（见上），不会因跳过 BOM 步骤而丢失。
  - **暴露代价（规则 7）**：非 CMake 项目中「缺 BOM 的老文件」必然被写入一次以补 BOM，触发 harness stale-file 重读、产生少量 token。这是「统一编码」与「省 token」在该场景的固有冲突，取前者，属可接受代价。已有 BOM 的老文件则零写入。
- **copyright**：仅走全套的文件。同日不重复更新 Date 行；`company` 空则整头不写。
  - **`dateFormat` 真正生效（格式串，非固定日期）**：`dateFormat` 是**当前日期的显示格式模板**，按它格式化「当前时间」生成 Date 行——不是让用户填固定日期。支持占位符：`YYYY`(4位年) `MM`(2位月) `DD`(2位日) `HH`(2位时) `mm`(2位分)，字符串替换实现（替换顺序保证 `MM`/`mm` 不互相误伤）。
    - 例：`dateFormat: "YYYY-MM-DD"` → `// Date 2026-05-30`；`dateFormat: "YYYY/MM/DD HH:mm"` → `// Date 2026/05/30 14:08`。
  - **格式合法性约束（消解同日去重歧义）**：`dateFormat` **必须同时包含 `YYYY`、`MM`、`DD` 三个占位符**（可选再加 `HH`/`mm`）。校验不通过（缺任一、或乱序无法定位）→ **回退默认 `YYYY/MM/DD HH:mm`**（stderr 一行提示）。这样保证同日去重总能提取到年月日。
  - **同日去重（用 dateFormat 动态生成解析正则）**：判断「今天是否已写过」时，由当前 `dateFormat` 把占位符替换成命名捕获组（`YYYY→(?<Y>\d{4})`、`MM→(?<M>\d{2})`、`DD→(?<D>\d{2})`，其余字符转义为字面量）生成正则，从已有 Date 行提取年月日，与今天比对。相等则**跳过整次写入**（同天只写一次）；不等或无 Date 行则更新。因已强制含 YMD，提取必然成功。
  - **BOM 字节顺序铁律（CRITICAL，复用 `lib/bom_util.js`）**：插入/更新版权头**必须**经 `bom_util.stripBom` 剥前导 BOM → 在无 BOM 正文上插/改头 → `bom_util.restoreBom(hadBom, body)` 拼回（带 BOM 则版权头在 BOM **之后**）。**绝不可**把版权头写到 BOM 字节之前。**更新已有头时**：若历史文件把头错写在了 BOM 之前（旧 bug 产物），更新逻辑一并归正到 BOM 之后。
  - 写入承诺：内容无变化（如同日跳过）不写回。
- **cpplint**：见 §6。仅走全套的文件。

**入口顶层总 try/catch**：任何未预期异常 → 最坏 `passSilent()`，绝不把异常冒泡成 hook 错误。

## 6. cpplint 临时副本方案（cpplint 步骤不写回原文件）

cpplint 读取的是**经流水线前 3 步（clang-format/BOM/copyright）处理后的磁盘文件**——即应被检查的最终态。cpplint 自身**不写回任何文件**：

```
1. 读当前磁盘文件字节，剥除前导 BOM，得到无 BOM 内容
2. 写到 os.tmpdir/cpp-style-enforcer/<projHash>/<relPathHash>-<basename>（临时副本）
   - 用"相对仓库根路径的 hash"做前缀，避免不同目录同名文件（多个 main.cpp）副本互相覆盖
3. 对临时副本跑 cpplint.py（spawn python，一次）
4. 解析 stderr 违规输出，把临时文件名映射回原 basename 展示
5. 删除临时副本（失败无所谓，下次覆盖）
被检查的原文件在 cpplint 步骤全程零写入；进程被 timeout 杀掉只丢临时文件，绝不损坏源文件
```

违规处理：
- **硬违规（强制修复）**：clang-format 管不了的真违规 → 有硬违规即 `blockClaude(reason)`：exit 0 + stdout `{"decision":"block","reason":<去重后前5条+修复指令>}`。
- **软违规（建议性，不强制）**：`build/header_guard` 与 `build/include_subdir` 降为软违规——它们是 clang-format 管不了的真违规，但 header_guard 可改用 `#pragma once`、include_subdir 因项目 include 习惯而异，硬改可能破坏编译，故只给**建议性提示**（仍走 `blockClaude` 出口，但文案为「建议项，非强制，可保留现状，自行判断后继续」）。仅当**无任何硬违规、只剩软违规**时才发此建议。
- **filter 精简（基于实测，新架构无需防互搏 filter）**：删除了旧的 `-build/include_order` / `-whitespace/indent_namespace` / `-whitespace/comments` filter——因为新架构下走全套的文件先经 Google **整文件格式化**再 lint，format 已对齐 Google，这三类 lint 项恒不报，无需 filter 屏蔽。
- **仅保留按需 `-legal/copyright`**：`company` 空 或 `copyright` 关 → filter 屏蔽 `legal/copyright`，避免缺头误拦。无任何 filter 项时不传 `--filter`。
- python 不在 / cpplint 不可用 → 静默跳过（stderr 一行提示），`passSilent()`。

### 6.1 违规过滤与截断（喂给 Claude 的内容）

cpplint 一次可能吐数十条违规；全量回灌会浪费 token 且其中多为连锁回声。策略：

1. 解析全部违规为数组（`{line, message, category}`）。
2. **逐字去重**：以 `${line}:${category}:${message}` 为 key 进 Set，只去掉**完全相同**的重复条目（O(n) 一次遍历，零复杂度）。
   - 只去逐字相同行；**不做**语义/连锁去重（修 A 后 B 消失这类无法静态判定，交给迭代收敛）。
   - 不同行的同类违规视为独立问题，保留。
3. 取去重后的**前 5 条**喂给 Claude（保证 5 条互不相同，最大化每轮信息量）。
4. 附注：`... 还有 N 条违规未显示，修复以上后重新编辑该文件以重新检查`。
5. **迭代收敛**：Claude 修完 → 重新编辑 → hook 重跑 → 下一批 5 条，直到无违规。连锁误报在重跑后自然消失。

`MAX_ERRORS_SHOWN = 5`（去重之后再 slice）。不解析/不使用 confidence 字段。

## 7. 协议层（`protocol.js`，唯一三个出口）

```
passSilent()        → process.exit(0)               // stdout 空、stderr 空
blockClaude(reason) → console.log(JSON{decision:"block",reason}); exit(0)  // PostToolUse 强制修
denyTool(reason)    → console.log(JSON{hookSpecificOutput:{permissionDecision:"deny",
                       permissionDecisionReason:reason}}); exit(0)         // PreToolUse 阻止 commit
```

铁律：
- 诊断/进度信息一律 `process.stderr.write`，**绝不混入 stdout**。
- **永不 exit 1**（规避 issue #4809）。
- **永不 exit 2**（旧崩溃源；改用 exit 0 + JSON）。
- stdout 要么为空，要么是一段纯 JSON，绝不文本+JSON 混合。

## 8. 三个 Hook 入口行为

### SessionStart（`session_start.js`）
- `ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE)`：用户模板不存在则从出厂默认复制。
- `spawnPrewarm()`：后台 detached 子进程自举 iconv-lite / clang-format（见 §9.1），立即返回不阻塞、不占 10s timeout、stdio 全丢弃静默；失败返回 null 不影响 exit 0。
- exit 0，**无任何 stdout/stderr 输出**，不检测 C++ 项目，不拦截，不弹问。
- 职责：保证全局默认配置文件存在 + 后台预热依赖。

#### `ensureUserTemplate` 铁律（不可违反）
- 全局模板 `~/.claude/cpp-style-template.json` **若已存在，绝不覆盖、绝不写入**——直接返回。
- 只有在它**不存在**时，才从插件出厂默认 `templates/cpp-style-template.default.json` 复制一份过去。
- 理由：用户在全局模板里填的公司名 / 作者 / 开关是其长期配置，覆盖会无声丢失用户数据。
- 实现：`if (fs.existsSync(userPath)) return userPath;` 必须在任何写操作之前；复制用 `copyFileSync`，且仅此一处会写该文件。
- 复制失败（如目录权限）→ try/catch 吞掉，调用方按「无全局模板」降级到硬编码默认，不崩。

### PostToolUse（`post_edit.js`）
- matcher：`Write|Edit|MultiEdit|NotebookEdit|mcp__.*(?:write|edit|create|replace|insert)`
  - **移除旧的 `Bash` matcher**：Bash 命令不产生 `tool_input.file_path`，过滤后必然 `passSilent`，匹配它只是对每条 Bash 命令空跑一次 node 进程（与省 token 相悖），且旧崩溃曾因「Bash 字符串含 .cpp」误触发。文件编辑只走 Write/Edit/MultiEdit/NotebookEdit/MCP。
- 流程：读 stdin → resolveFilePath → shouldHandle 过滤（扩展名/排除目录/SKIPPED_FILES）→ 读配置 → `enabled` 检查 → §5 流水线 → cpplint 决定 `blockClaude` 或 `passSilent`。
- **PostToolUse 只读配置、绝不创建/写全局模板**（创建只在 SessionStart）。全局模板缺失 → 直接降级硬编码默认，不调用 ensureUserTemplate，避免并发写。
- **删除** `mode===null` 兜底拦截分支（旧崩溃源）。
- 未启用（`enabled:false`）/ 非 C++ / 排除目录 / 文件不存在 → `passSilent()`。

### PreToolUse（`pre_commit.js`）
- matcher：`Bash`
- 仅拦截 `git commit` 命令；对暂存区 C++ 文件（incremental 仅新文件）跑 cpplint。
- **commit 命令识别需防误判**：用收紧的正则匹配真正的 `git commit`（词边界），排除 `echo "git commit"`、`git commit-graph`、`git commit-tree` 等假阳性；无法确定时**宁可放行**（不阻止），不重蹈旧版「Bash 字符串误触发」覆辙。
- 违规 → `denyTool(reason)` 阻止提交；无违规/降级 → `passSilent()`。

### `/cpp-style-setup` 命令
- 重写为：查看/编辑全局模板 `~/.claude/cpp-style-template.json`（公司名、作者、默认开关、默认 mode），或为当前项目写 `.claude-cpp-style/cpp-style.json` 覆盖（含 `enabled:false` 关闭）。
- **去掉**「必须 AskUserQuestion 弹问选模式」的拦截语义；纯按需配置工具。

## 9. 错误处理与降级

- **降级铁律**：git / python / clang-format 任一缺失或失败 → 对应步骤静默跳过，其余照跑，整体 `passSilent()`。
- iconv-lite 缺失 → GBK 转码步骤跳过（try/catch 吞），不崩。
- 所有文件读写包 try/catch；写文件前判断内容是否变化，无变化不写。
- 配置解析失败 → 默认值。
- stdin 空 / 非法 JSON / 文件不存在 → `passSilent()`。

### 9.1 依赖自举（`lib/ensure_deps.js`）

**前提：用户须自备 python + node**（hook 运行时与 cpplint 解释器，插件不代装这两者）。其余依赖按需自动补齐，全程不阻塞、静默、失败安全降级。

- **cpplint**：内置 `cpplint/cpplint.py`，靠用户的 python 运行，无需安装。
- **iconv-lite（GBK 转码）**：缺失时由 SessionStart 后台预热触发 `npm install`（`ensureIconvLite`）；装不上则写失败标记 `.iconv-install-failed`、不重复装，GBK 文件**跳过**（不转码、不损坏）。
- **clang-format**：缺失时后台预热触发 `pip install clang-format`（`ensureClangFormat` → `pipInstallClangFormat`，靠 python，跨平台最稳）；装不上则写失败标记 `.clang-format-install-failed`、不重复装，格式化步骤跳过。
  - **检测三种调用方式**（`detectClangFormat`，按序探测 `--version`）：1) PATH 的 `clang-format`；2) `python -m clang_format` / `python3 -m clang_format`（pip 包模块入口）；3) python Scripts 目录（`sysconfig.get_path('scripts')`）下的 `clang-format` 可执行（pip 入口脚本常落于此且可能不在 PATH）。
- **自举时机**：均在 **SessionStart 后台 detached 进程**（`spawnPrewarm` → 子进程跑 `ensure_deps.js --prewarm` 分支）执行，立即 `unref` 返回不阻塞、不占 SessionStart 的 10s timeout、stdio 全丢弃保持静默。
- **不重复安装**：检测到可用直接返回不触发安装；安装失败写标记，后续凭标记跳过。
- **编辑期只检测不安装**：PostToolUse 流水线只 `detectClangFormat` / `require('iconv-lite')`，不在编辑期同步安装（避免阻塞编辑）。

## 10. 测试策略

GoogleTest 不适用（纯 JS hook）。用 node 断言脚本，置于 `hooks/js/__tests__/`：

### 单元测试
- `config`：字段级覆盖正确、损坏 JSON 回退默认、`enabled:false` 生效、checks 缺失默认 true。
- `ensureUserTemplate`：模板不存在→复制；**模板已存在→绝不覆盖（写入前后字节完全一致，含用户自填的 company/author）**；复制失败→不崩。
- `git.isNew`：已跟踪→false、未跟踪→true、非 git 仓库→true。
- `project.findCMakeRoot`：文件同级有 CMakeLists.txt→命中；上层有→向上找到；都没有→null；**非 git 的 CMake 项目→仍命中**；null/不存在路径→不崩。
- `bom_util`：`stripBom`/`restoreBom` 往返字节级一致（带/不带 BOM）；多前导 BOM 归一为一个；detectEncoding 正确分类 UTF-8/UTF-8-BOM/UTF-16/GBK。
- `bom`（步骤）：UTF-8 无 BOM→补、已有 BOM→不重复、GBK→转码、UTF-16→跳过、空文件→只写 BOM、**CMake 项目→跳过 BOM**、**非 git 的 CMake 项目→也跳过 BOM**。
- `clang_format`：**无变化→不写回（mtime 不变）**、有变化→写回、**带 BOM 文件格式化后 BOM 仍是首字节（strip/restore 保全）**、clang-format 不在 PATH→静默跳过。
- `copyright`：无头→插入、有头→更新、company 空→不写、**含 BOM 文件插头后 BOM 仍是首字节**、
  - dateFormat 生效：`YYYY-MM-DD`→`2026-05-30`、`YYYY/MM/DD HH:mm`→带时间；
  - **dateFormat 缺 YMD（如仅 `YYYY`、或 `MM-DD`）→ 回退默认格式**；
  - **同日去重**：同天第二次编辑（含 `HH:mm` 格式下分钟不同）→ Date **不刷新、整次跳过**；跨天→更新。
- `cpplint`：违规输出解析正确、临时副本相对路径 hash 防同名碰撞、映射回原 basename、**cpplint 步骤不写回原文件（字节级未变）**、**逐字去重（同 line+category+message 只留一条）后取前 5 条**、附「还有 N 条」提示、不使用 confidence。

### 集成测试（回归取证场景）
临时 git 仓库喂各场景 stdin，断言 `(exit, stdout, stderr)`。**固化取证 agent 的 8 个场景为回归用例**，重点：
- 旧崩溃场景 a/e（未配置 / Bash 含 .cpp）：现在 → `passSilent()`（exit 0、无输出）。
- 全局默认 + 新文件 + cpplint 违规 → exit 0 + stdout 纯 `decision:block` JSON、stderr 有诊断。
- 旧文件（已跟踪）incremental → 仅格改动行（`SortIncludes:Never`）+ 补 BOM、不版权/不 lint。
- 单进程流水线总耗时 < 30s（无子 node 进程链）。
- cpplint 跑完原文件字节级未变。
- `enabled:false` → 完全 no-op。

### 验证方式
所有 JS 脚本执行验证（按全局规则：脚本类执行验证，强制）。

## 11. 非目标（YAGNI）

- 不做 baseline 兼容、不读任何旧字段。
- 不做并行化流水线（串行足够，单进程已远低于 30s）。
- 不做 HTTP hook、不做远程配置。
- `dateFormat` 仅支持 `YYYY/MM/DD/HH/mm` 五种占位符的字符串替换，不做完整 strftime/locale。
- **不代装 python / node**：这两者是用户前提，插件只自举 iconv-lite（npm）与 clang-format（pip）。
- **不改写项目文件，唯一例外是生成 `.clang-format`**：仅在走全套且项目根缺该文件时生成一份 `BasedOnStyle: Google`（已存在绝不覆盖、非 git 不生成）。除被编辑的源文件本身（格式化/BOM/版权）外，不碰项目里其它任何文件。
