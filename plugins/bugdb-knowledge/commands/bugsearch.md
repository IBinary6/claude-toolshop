# /bugsearch — 直接查询知识库

## 用法

`/bugsearch <错误信息或关键词>`

## 行为

调用：

```bash
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" search \
  --query "<用户输入>" \
  --format text
```

展示前 3 条结果（按 confidence DESC, success_count DESC 排序）。

## 高级用法

- 限定语言：`/bugsearch --language c++ <错误>`
- 包含废弃记录：`/bugsearch --include-deprecated <错误>`

直接将参数透传给 CLI。
