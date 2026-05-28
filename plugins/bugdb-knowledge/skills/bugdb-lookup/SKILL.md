---
name: bugdb-lookup
description: 查询本地 bug 知识库以避免重复试错的工具。用户在对话中提到、描述、粘贴任何编译/链接/运行时/构建/CI 错误时务必调用，即使用户没明确说"查库"或"找历史方案"——包括正式错误码（如 error C2065、LNK2001、error[E0308]、ModuleNotFoundError、fatal error）、非正式表达（如"xxx 报错"、"xxx 编译出错"、"xxx 找不到"、"段错误"、"崩溃"、"build 失败"）、以及工具执行后 stdout/stderr 中出现的错误信息。先调用本 skill 查库，未命中再走常规排查。只在用户问的是纯代码编写、概念解释、用法咨询（完全没有错误涉及）时跳过。
---

## 触发时机

满足以下任一条件即调用本 skill，无需用户显式要求：

1. **工具输出入口**：Claude 通过 Bash 或其它工具执行命令后，stdout/stderr 中包含错误信息。
2. **对话入口**：用户在消息中提到、描述或粘贴了任何编译/链接/运行时/构建错误，无论用词是规范的错误码、构建工具术语，还是非正式表达（例如以"…失败"、"…报错"、"…找不到"、"…崩溃"为代表的口语化描述）。

判断标准：**只要话题落在"某段代码或构建步骤没正常工作"的范畴**，就先查库再回答，不要先问澄清问题。

## 流程（必须按顺序执行）

### Step 1: 查询知识库（normalize 由 CLI 自动处理）

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" search \
  --query "<原始错误信息>" \
  --language <当前语言> \
  --format json
```

### Step 2: 解读结果

- confidence >= 70 且 status=active → 优先按 action_steps 数组逐步执行
- confidence < 70 或 status=deprecated → 参考但不盲从
- 无结果 → 跳到 Step 4

### Step 3: 尝试方案

按 action_steps 数组逐项执行，验证（重新编译/运行）。

- 成功 → `python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" feedback --id <id> --result success`
- 失败 → `python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" feedback --id <id> --result failure`，进入 Step 4

### Step 4: 降级处理（必须遵守）

知识库无解或方案失败，直接按正常排查流程处理。

- 不得因知识库未命中而停顿
- 不得反复查库
- 解决后评估是否值得记录 → 调用 bugdb-record skill

## 约束

- 查询阶段只跑一次 Step 1（不允许重写 query 反复查）；feedback 是必要后续，不算查询次数
- 查库失败（CLI 不存在、DB 不存在）→ 静默跳过
- 永远不能因知识库而阻塞主线任务

## 跨语言错误处理规则

报错发生在 Python 调 C++ 扩展崩溃 → language 填崩溃点语言（c++）。
以**报错栈顶**的语言为准。
