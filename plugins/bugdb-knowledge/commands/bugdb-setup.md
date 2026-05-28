# /bugdb-setup — 一键完成插件配置

安装 bugdb-knowledge 插件后，执行此命令完成剩余配置。

## 流程

按以下步骤依次执行，每步汇报结果：

### Step 1: 安装 Python 包

```bash
pip install -e "${CLAUDE_PLUGIN_ROOT}"
```

失败时检查：
- `python --version` 是否 >= 3.11
- pip 是否可用
- 报告具体错误，不要静默跳过

### Step 2: 验证 CLI 可用

```bash
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" stats --format text
```

失败则报告错误并停止。

### Step 3: 追加 CLAUDE.md 触发规则

检查 `~/.claude/CLAUDE.md` 是否已包含 `bugdb-lookup` 关键词。

- **已存在** → 跳过，告知用户"触发规则已配置"
- **不存在** → 在文件末尾追加以下内容：

```markdown

## Bug 知识库触发规则

遇到以下情况，调用 bugdb-lookup skill：

- 任何编译错误（error C*, error:, fatal error）
- 任何链接错误（LNK*, unresolved external）
- 任何构建工具失败（cmake, ninja, msbuild, make FAILED）
- 任何运行时崩溃（access violation, segfault, ModuleNotFoundError）

成功解决 bug 后，评估复现概率 > 50% 则调用 bugdb-record skill 录入。

跨语言错误以报错栈顶语言为准。
```

- **文件不存在** → 创建文件并写入上述内容

### Step 4: 汇报结果

输出安装摘要：

```
bugdb-setup 完成：
  ✓ Python 包已安装（bugdb CLI 可用）
  ✓ 数据库路径：<db_path>
  ✓ CLAUDE.md 触发规则已配置
  
  使用 /bugsearch <关键词> 搜索知识库
  使用 /bugfix 交互式录入知识条目
```

## 约束

- 不得修改用户 CLAUDE.md 中已有的内容
- 追加时必须在文件末尾，用空行分隔
- 任何步骤失败必须明确报告，不得静默跳过
