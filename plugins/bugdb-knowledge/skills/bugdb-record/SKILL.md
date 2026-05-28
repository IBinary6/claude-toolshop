---
name: bugdb-record
description: 把已验证的解决方案、经验、决策落库以便日后查询的工具。用户告诉你某个 bug 已修好、构建配置已跑通、工具技巧已验证、架构方案已敲定时务必调用，即使用户没明确说"记录"或"录入"——触发信号包括："搞定了 / 终于跑通 / 解决了 / 通过了 / 决定用 / 定下来了 / 排查到根因 / 刚发现 / 已确认有效"等表达成功完成或结论达成的语句。本 skill 自动做去重检查后录入，避免重复条目。只在用户还在排查中、在问"怎么做"或纯讨论假设方案时跳过。
---

## 触发时机

满足任一条件即调用本 skill，无需用户显式要求：

1. 刚验证过一个 bug 的修复方案有效（编译通过 / 测试通过 / 行为恢复正常）
2. 排查过程中发现了非显然的构建/工具/配置技巧，且未来很可能再用到
3. 完成了一个有持久价值的架构决策或工作流（值得复用而非一次性的）

如果方案是"试试看碰运气"、或只解决了本地环境特殊问题，跳过录入（见末尾"录入门槛"）。

## Step 1: 去重检查

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" find-similar \
  --pattern "<错误关键词或知识主题>" \
  --threshold 0.7
```

`find-similar` 覆盖**全部状态**（active / deprecated / obsolete / archived），按命中记录的 `status` 选择动作（命令均以 `python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" ...` 调用，下表省略前缀）：

| 命中 status | 动作 |
|------------|------|
| `active`     | `update --id <id> --content ...` 增强已有，不新增 |
| `deprecated` | 沿 `replaced_by_id` 链找最新方案；若仍不适用再考虑新增（用 `--valid-for` 区分场景） |
| `obsolete`   | 旧方案确认失效，新增并在 `cause` 写明与旧记录的差异 |
| `archived`   | `restore --id <id>` 恢复后再 `update --id <id> ...` 补充内容，**不要重复新增** |

## Step 2: 录入

```
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" add \
  --entry-kind <bug|practice|tool|decision|workflow> \
  --category <见下表> \
  --context "<原始完整错误或适用背景>" \
  --cause "<根因或知识背景>" \
  --content "<方案简述或知识内容>" \
  --action-steps '["步骤1","步骤2"]' \
  --title "<可选标题>" \
  --language <语言> \
  --project-type <vs|cmake|cargo|npm|makefile|any> \
  --tags "<tag1,tag2>"
```

`entry-kind` 与 `category` 的合法组合（CLI 会校验，组合错误直接退出 2）：

| entry-kind | 允许的 category |
|------------|----------------|
| `bug`      | `compile` / `link` / `runtime` / `type` / `import` / `build` / `config` |
| `practice` | `practice` |
| `tool`     | `tool` |
| `decision` | `decision` |
| `workflow` | `workflow` |

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
