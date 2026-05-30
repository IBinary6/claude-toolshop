---
description: cpp-style-enforcer 手动配置 / 重置 — 选择 full/incremental 写入 .claude-cpp-style，或查看/编辑用户模板
---

# /cpp-style-setup — C++ 风格检查配置 / 重置

**可选命令**。装好插件后，SessionStart 钩子会在检测到 C++ 项目且缺少 `.claude-cpp-style` 时自动提示选择模式，通常无需手动跑这个命令。

本命令用于：**手动初始化 / 重置当前项目的风格检查配置**，或**查看 / 编辑用户级模板**。

## 执行流程

按以下步骤执行。**遇到决策点必须使用 AskUserQuestion 工具询问用户，不要假设。**

### Step 1: 检测当前项目

执行：

```bash
git rev-parse --show-toplevel
```

- 非 git 仓库 / 命令失败 → 告知用户「当前目录不是 git 仓库，本插件依赖 git 区分新旧文件，无法配置」，停止。
- 成功 → 记下仓库根目录，继续 Step 2。

### Step 2: 读用户模板

读取 `~/.claude/cpp-style-template.json`（不存在时插件 SessionStart 已自动创建；若仍缺失，从插件 `templates/cpp-style-template.default.json` 复制理解其结构）。把其中的 `checks` 与 `copyrightInfo` 作为待写入 `.claude-cpp-style` 的内容基底。

**用 AskUserQuestion 询问用户本次意图**，给出选项：

- 选项 A：「配置当前项目的风格检查模式」→ 继续 Step 3
- 选项 B：「查看 / 编辑用户模板（公司名、作者、默认开关）」→ 跳到 Step 5

### Step 3: 选择模式

检查仓库根目录是否已存在 `.claude-cpp-style`：
- 已存在 → 先用 AskUserQuestion 确认「已有配置，是否覆盖重置？」，用户拒绝则停止。

**用 AskUserQuestion 询问模式**：

- 选项 1：「新项目 — 所有文件完整检查（full）」
- 选项 2：「老项目 — 仅新文件完整检查，旧文件只补 BOM（incremental）」

若选 incremental，执行 `git rev-parse HEAD` 取当前 HEAD 作为 baseline。

### Step 4: 写入 .claude-cpp-style

用 Write 工具在仓库根目录写入 `.claude-cpp-style`（JSON）。内容 = 用户模板的 `checks` + `copyrightInfo`，叠加本次选择：

- full：`{ ...模板, "mode": "full" }`（不含 baseline）
- incremental：`{ ...模板, "mode": "incremental", "baseline": "<HEAD hash>" }`

提醒用户：
- 该文件建议加入 `.gitignore`。
- `copyrightInfo.company` 为空时不会写版权头（cpplint 同步屏蔽 legal/copyright）。

汇报写入路径与最终内容，结束。

### Step 5: 查看 / 编辑用户模板

打印 `~/.claude/cpp-style-template.json` 当前内容。**用 AskUserQuestion 询问是否修改**公司名 / 作者 / 默认开关：

- 用户要改 → 收集新值，用 Edit/Write 更新该文件，告知「之后新项目自动继承，已配置项目不受影响」。
- 用户不改 → 结束。

## 约束

- 决策点必须用 AskUserQuestion 工具，不得自作主张。
- 不替用户决定 full / incremental，必须问。
- incremental 的 baseline 必须用实际 `git rev-parse HEAD` 输出，不得编造 hash。
- 覆盖已有 `.claude-cpp-style` 前必须二次确认。
- 字段含义见 `hooks/js/cpp_style_guard/readme.txt`。
