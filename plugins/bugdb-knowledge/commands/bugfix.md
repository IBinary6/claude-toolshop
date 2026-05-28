# /bugfix — 交互式录入 Bug 知识库

引用 bugdb-record Skill 规范，确保手动录入也遵循统一标准。

## 流程

1. 询问用户错误信息（粘贴原始 stderr / build log）
2. 询问根因（一句话概括）
3. 询问方案 + 步骤列表（JSON 数组形式）
4. 询问语言（c++ / rust / python / go / js / any）
5. 询问项目类型（vs / cmake / cargo / npm / makefile / any）
6. 询问 tags（逗号分隔，可选）
7. 调用 `python "${CLAUDE_PLUGIN_ROOT}/scripts/bugdb/cli.py" find-similar --pattern "<关键词>"` 去重
8. 若无相似记录，调用：

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/bugdb/cli.py" add \
  --error-type <type> \
  --error-message "<原始错误>" \
  --root-cause "<根因>" \
  --solution "<方案>" \
  --solution-steps '["步骤1","步骤2"]' \
  --language <lang> \
  --project-type <project> \
  --tags "<tags>"
```

9. 录入后调用 `bugdb search --query <error_message>` 验证可搜到

## 注意

- 复现概率 < 50% 的一次性问题不要录入
- 已有相似记录时改用 `bugdb update`
- 详细规范见 bugdb-record skill
