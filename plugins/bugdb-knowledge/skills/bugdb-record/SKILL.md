---
name: bugdb-record
description: 将已解决的 bug 或知识条目按规范录入知识库。确保去重检查，避免"录了但搜不到"问题。
---

## Step 1: 去重检查

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" find-similar \
  --pattern "<错误关键词>" \
  --threshold 0.7
```

若有相似记录 → 用 `bugdb update` 更新已有，不新增。

## Step 2: 录入

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" add \
  --entry-kind <bug|practice|tool|decision|workflow> \
  --category <compile|link|runtime|type|import|build|config|practice|tool|decision|workflow> \
  --context "<原始完整错误或适用背景>" \
  --cause "<根因或知识背景>" \
  --content "<方案简述或知识内容>" \
  --action-steps '["步骤1","步骤2"]' \
  --title "<可选标题>" \
  --language <语言> \
  --project-type <vs|cmake|cargo|npm|makefile|any> \
  --tags "<tag1,tag2>"
```

`key_pattern` 由 CLI 自动从 context 调用 normalize() 生成，无需手动构造。

## Step 3: 录入后验证

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" search --query "<context>" --language <语言>
```

若搜不到自己刚录入的 → 报告问题（可能是 normalizer 过度清洗，需调整规则）。

## 录入门槛

- 复现概率 > 50%
- 解决方案明确（不是"试试看"级别）
- 不录入一次性环境问题（如本地配置缺失）
