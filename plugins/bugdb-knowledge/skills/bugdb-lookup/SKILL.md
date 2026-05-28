---
name: bugdb-lookup
description: 遇到编译/链接/运行时/构建错误时，优先查询本地 Bug 知识库再排查。适用：error C*, LNK*, fatal error, ModuleNotFoundError, cmake/ninja 失败等。
---

## 流程（必须按顺序执行）

### Step 1: 查询知识库（normalize 由 CLI 自动处理）

```
python ~/.claude/scripts/bugdb/cli.py search \
  --query "<原始错误信息>" \
  --language <当前语言> \
  --format json
```

### Step 2: 解读结果

- confidence >= 70 且 status=active → 优先按 solution_steps 数组逐步执行
- confidence < 70 或 status=deprecated → 参考但不盲从
- 无结果 → 跳到 Step 4

### Step 3: 尝试方案

按 solution_steps 数组逐项执行，验证（重新编译/运行）。

- 成功 → `python ~/.claude/scripts/bugdb/cli.py feedback --id <id> --result success`
- 失败 → `python ~/.claude/scripts/bugdb/cli.py feedback --id <id> --result failure`，进入 Step 4

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
