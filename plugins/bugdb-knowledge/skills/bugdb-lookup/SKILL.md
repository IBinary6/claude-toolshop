---
name: bugdb-lookup
description: 任何涉及编译、链接、运行时或构建错误的场景都先调用：无论错误来自工具执行的输出，还是用户在对话中提及、描述、贴出的错误信息。先查本地知识库再排查，避免重复试错。
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

- 整个查库过程不得超过 1 次 Bash 调用
- 查库失败（CLI 不存在、DB 不存在）→ 静默跳过
- 永远不能因知识库而阻塞主线任务

## 跨语言错误处理规则

报错发生在 Python 调 C++ 扩展崩溃 → language 填崩溃点语言（c++）。
以**报错栈顶**的语言为准。
