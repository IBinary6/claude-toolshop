# bugdb-knowledge — 本地知识库插件

基于 SQLite + FTS5 全文检索的 Claude Code 插件，为开发过程提供**持久化经验积累**。

不仅记录 Bug 修复方案，还支持最佳实践、工具使用技巧、架构决策、工作流程等通用知识条目。所有数据存储在本地，无需外部服务。

---

## 它能做什么？

| 场景 | 行为 |
|------|------|
| Bash 执行报错（编译/链接/运行时错误） | Hook **自动**查询知识库，命中时注入方案提示 |
| Claude 遇到错误需要排查 | 调用 `bugdb-lookup` skill 按规范流程查库 |
| 成功解决了一个 Bug | 调用 `bugdb-record` skill 录入知识库 |
| 想记住一个最佳实践/工具技巧 | `/bugfix` 命令交互式录入 |
| 手动搜索已有知识 | `/bugsearch <关键词>` 直接查询 |

**核心价值**：解决过的问题不会被遗忘。同样的错误再次出现时，几秒内自动命中历史方案。

---

## 安装

### 方式一：Plugin Marketplace（推荐）

```bash
/plugin marketplace add IBinary6/claude-toolshop
/plugin install bugdb-knowledge@claude-toolshop
```

安装后执行一键配置：

```
/bugdb-setup
```

该命令自动完成 Python 包安装、CLAUDE.md 触发规则追加、安装验证。

### 方式二：手动安装

详见 [docs/MANUAL_INSTALL.md](./docs/MANUAL_INSTALL.md)。

### 验证安装

```bash
# CLI 可用性
bugdb --help

# 或直接调用
python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" stats
```

### 前置依赖

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Python | 3.11+ | CLI 核心（数据库、搜索、归一化） |
| Node.js | 18+ | PostToolUse Hook 运行时 |
| pip | — | 安装 Python 包 |

### CLAUDE.md 配置

> 如果使用 `/bugdb-setup` 命令安装，CLAUDE.md 配置会自动追加，无需手动操作。

手动追加时，在 `~/.claude/CLAUDE.md` 文末加入：

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

---

## 整体架构

```
用户在 Claude Code 中工作
        │
        ▼
┌──────────────────────────────────────────────────┐
│               PostToolUse:Bash Hook              │
│  bugdb_check.js 监听每次 Bash 执行结果           │
│  检测到错误关键词 → 自动查询知识库                │
│  命中 → 注入 [BUGDB_MATCH] 提示给 Claude         │
│  未命中 / 出错 → 静默，不阻塞主流程              │
└──────────────────────────────────────────────────┘
        │                              │
    有匹配结果                      无匹配结果
        │                              │
        ▼                              ▼
┌─────────────────┐          ┌──────────────────┐
│ Claude 按方案    │          │ Claude 正常排查    │
│ 尝试修复        │          │                   │
│                 │          │ 解决后 →           │
│ 成功/失败 →     │          │ bugdb-record 录入  │
│ feedback 反馈   │          └──────────────────┘
└─────────────────┘

            ┌─────────────────────────────┐
            │        SQLite 数据库         │
            │  knowledge 表 + FTS5 索引    │
            │  ~/.claude/bugdb/bugs.db     │
            └─────────────────────────────┘
```

---

## 知识条目类型

插件支持 5 种条目类型（`entry_kind`）：

| 类型 | 说明 | 示例 |
|------|------|------|
| `bug` | Bug 修复记录（默认） | LNK2001 链接错误 → 添加 ws2_32.lib |
| `practice` | 编码最佳实践 | 优先使用 f-string 而非 .format() |
| `tool` | 工具使用技巧 | git rebase -i 合并提交的正确步骤 |
| `decision` | 架构决策记录 | 选择 SQLite 而非 PostgreSQL 的原因 |
| `workflow` | 工作流程记忆 | 发布前的检查清单 |

---

## 三种触发方式详解

### 1. Hook 自动触发（零操作）

**触发条件**：每次 Bash 工具执行完毕后，Hook 检查输出是否包含错误关键词。

**识别的错误模式**：
```
error C2065          # MSVC 编译错误
LNK2001              # MSVC 链接错误
fatal error          # 致命错误
FAILED               # 构建失败
error[E0308]         # Rust 编译错误
unresolved external  # 未解析外部符号
undefined reference  # GCC/Clang 链接错误
segmentation fault   # 段错误
access violation     # 访问违规
ModuleNotFoundError  # Python 模块缺失
No module named      # Python 导入失败
```

**流程**：
```
Bash 执行 → stdout/stderr 包含上述关键词
  → bugdb_check.js 提取错误行
  → base64 编码后调用 CLI search
  → 命中则输出 [BUGDB_MATCH] 信息
  → Claude 看到提示，按方案尝试修复
```

**输出示例**：
```
[BUGDB_MATCH] id=3 confidence=90 status=active
entry_kind=bug
category=link
content=add ws2_32.lib to linker dependencies
steps=["target_link_libraries(myapp PRIVATE ws2_32)"]
hint=如方案无效，忽略此提示继续正常排查
```

> Hook 有 5 秒超时限制，任何异常（Python 缺失、DB 不存在等）都静默处理，**绝不阻塞主流程**。

### 2. Skill 触发（Claude 主动调用）

插件提供两个 Skill，Claude 根据 CLAUDE.md 中的触发规则自动调用：

#### bugdb-lookup — 查询知识库

**何时触发**：Claude 遇到编译/链接/运行时/构建错误时。

**完整流程**：

```
Step 1: 查询
  bugdb search --query "<错误信息>" --language <语言> --format json

Step 2: 解读
  confidence >= 70 且 active → 按 action_steps 执行
  confidence < 70 或 deprecated → 参考但不盲从
  无结果 → 跳到 Step 4

Step 3: 尝试方案
  成功 → bugdb feedback --id <id> --result success
  失败 → bugdb feedback --id <id> --result failure → Step 4

Step 4: 降级
  正常排查，不因知识库无解而停顿
  解决后评估是否录入 → 调用 bugdb-record
```

#### bugdb-record — 录入知识

**何时触发**：成功解决 Bug 后，复现概率 > 50%。

**完整流程**：

```
Step 1: 去重检查
  bugdb find-similar --pattern "<关键词>" --threshold 0.7
  有相似 → bugdb update 更新已有记录

Step 2: 录入
  bugdb add --entry-kind bug --category compile \
    --context "<原始错误>" --cause "<根因>" \
    --content "<方案>" --action-steps '["步骤1","步骤2"]' \
    --language c++ --project-type vs --tags "linker"

Step 3: 验证
  bugdb search --query "<context>" --language <语言>
  搜不到 → 报告问题（可能是 normalizer 过度清洗）
```

### 3. 斜杠命令（用户手动触发）

| 命令 | 用法 | 说明 |
|------|------|------|
| `/bugfix` | 在 Claude Code 中输入 `/bugfix` | 交互式引导录入知识条目 |
| `/bugsearch` | `/bugsearch <错误信息或关键词>` | 直接查询知识库并展示结果 |

**`/bugfix` 交互流程**：
1. Claude 询问错误信息（粘贴原始 stderr / build log）
2. 询问根因（一句话概括）
3. 询问方案 + 步骤列表
4. 询问语言和项目类型
5. 询问 tags（可选）
6. 自动去重检查
7. 无重复则录入
8. 搜索验证可被检索到

---

## CLI 完整用法

所有外部调用方（Hook/Skill/Command）统一通过 CLI 入口。可通过 `bugdb <子命令>` 或 `python cli.py <子命令>` 调用。

默认输出 JSON，`--format text` 切换为人类可读格式。

### 搜索

```bash
# 基本搜索
bugdb search --query "LNK2001 unresolved external" --language c++

# base64 编码查询（Hook 用，避免 shell 注入）
bugdb search --query-b64 <base64_string> --format json

# 包含废弃记录
bugdb search --query "error" --include-deprecated --limit 5

# 录入前去重
bugdb find-similar --pattern "LNK2001" --threshold 0.7

# 错误消息归一化（调试用）
bugdb normalize --input "C:/proj/main.cpp(42): error LNK2001"
# → {"normalized": "error LNK2001", "keywords": "LNK2001"}
```

### 录入

```bash
# 录入 Bug 修复记录
bugdb add \
  --entry-kind bug \
  --category link \
  --context "error LNK2001: unresolved external symbol __imp_WSAStartup" \
  --cause "缺少 ws2_32.lib 链接库" \
  --content "在 CMakeLists.txt 中添加 target_link_libraries(app PRIVATE ws2_32)" \
  --action-steps '["打开 CMakeLists.txt","在 target_link_libraries 中追加 ws2_32","重新构建"]' \
  --language c++ \
  --project-type cmake \
  --tags "linker,windows,winsock"

# 录入最佳实践
bugdb add \
  --entry-kind practice \
  --category python \
  --key-pattern "f-string formatting" \
  --cause "字符串格式化场景" \
  --content "优先使用 f-string，比 .format() 和 % 格式化更清晰高效" \
  --action-steps '["将 .format() 替换为 f-string","将 % 格式化替换为 f-string"]' \
  --title "Python f-string 最佳实践"

# 录入工具技巧
bugdb add \
  --entry-kind tool \
  --category tool \
  --key-pattern "git rebase squash" \
  --cause "需要合并多个提交为一个" \
  --content "使用 git rebase -i HEAD~N 交互式变基" \
  --action-steps '["git rebase -i HEAD~N","将要合并的提交标记为 squash","保存退出编辑器","编辑合并后的提交信息"]' \
  --title "Git 交互式变基合并提交"
```

### 查询与管理

```bash
# 按 ID 查询
bugdb get --id 3

# 列出所有活跃记录
bugdb list --status active --language c++

# 列出所有状态
bugdb list --status all

# 数据库统计
bugdb stats --format text
```

### 更新与反馈

```bash
# 更新已有记录
bugdb update --id 3 --content "新方案" --cause "更新根因"

# 方案有效反馈（提升 confidence）
bugdb feedback --id 3 --result success

# 方案无效反馈（触发 confidence 衰减）
bugdb feedback --id 3 --result failure

# 标记为废弃（有替代方案）
bugdb deprecate --id 3 --replace-with 7 --reason "旧方案不适用于 CMake 3.20+"

# 标记为不可用（无替代）
bugdb obsolete --id 3 --reason "该 API 已被移除"
```

### 删除与恢复

```bash
# 软删除（标记为 archived，可恢复）
bugdb delete --id 3

# 物理删除（不可恢复）
bugdb delete --id 3 --hard

# 恢复软删除
bugdb restore --id 3
```

### 导入导出

```bash
# 导出全部数据到 JSON
bugdb export --output backup.json

# 从 JSON 导入（兼容 v1 旧格式和 v2 新格式）
bugdb import --input backup.json
```

### 配置管理

```bash
# 查看当前路径配置
bugdb config path

# 查看某个配置项
bugdb config get db_path

# 设置配置项
bugdb config set db_path /custom/path/bugs.db

# 初始化默认配置文件
bugdb config init
```

---

## 置信度衰减机制

每条记录有 `confidence` 分数（0-100），通过 feedback 自动调整：

```
feedback --result success → success_count+1, consecutive_failures 清零
feedback --result failure → consecutive_failures+1

衰减触发条件（同时满足）：
  1. consecutive_failures >= 3（连续失败 3 次）
  2. success_count / usage_count < 30%（历史成功率低）

衰减效果：
  confidence -= 20（每次衰减扣 20 分）
  confidence 最低降到 20

自动废弃：
  confidence <= 20 → status 自动变为 deprecated
  deprecation_note = "auto: low confidence"
```

这确保了**低质量方案会自动淘汰**，不会反复误导。

---

## 搜索原理

### 两轮策略

```
第一轮：key_pattern 精确匹配（FTS5 BM25 相关性排序）
  ↓ 无结果
第二轮：context + cause + content 全文回退

→ 取 limit × 3 条候选（overfetch）
→ Python 按 confidence DESC, success_count DESC 重排
→ 返回 top-N 结果
```

### 归一化流水线

用户输入的错误信息会经过归一化清洗，再进入搜索：

```
原始：C:\proj\main.cpp(42): error LNK2001: unresolved external symbol
  ↓ 剥离 Windows 路径
  ↓ 剥离 Unix 路径
  ↓ 剥离时间戳
  ↓ 剥离 UUID
  ↓ 剥离裸文件名（main.rs, foo.cpp 等）
  ↓ 剥离行号（:42:5）
  ↓ 剥离内存地址（0xDEADBEEF）
  ↓ 压缩空白
归一化：error LNK2001 unresolved external symbol
  ↓ 提取关键词
关键词：LNK2001 unresolved external symbol
```

这样 **同一个错误在不同文件、不同行号出现时，都能命中同一条记录**。

---

## 数据存储

默认路径 `~/.claude/bugdb/`：

| 文件 | 说明 |
|------|------|
| `bugs.db` | SQLite 数据库（含 knowledge 表 + FTS5 索引） |
| `bugdb.log` | 操作日志（rotating，最大 1MB × 3 份） |
| `config.json` | 可选配置文件 |

### 自定义路径

路径解析优先级：

1. `BUGDB_HOME` 环境变量 → 该目录下的 `bugs.db` / `bugdb.log`
2. `~/.claude/bugdb/config.json` 中的 `db_path` / `log_path` 字段
3. 默认 `~/.claude/bugdb/`

```bash
# 示例：将数据库放到自定义目录
export BUGDB_HOME=/data/my-knowledge-base

# 或通过 config 设置
bugdb config set db_path /data/my-knowledge-base/bugs.db
```

---

## 数据库 Schema

`knowledge` 表字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 自增主键 |
| `entry_kind` | TEXT | 条目类型：bug / practice / tool / decision / workflow |
| `category` | TEXT | 分类：compile / link / runtime / type / import / build / config / practice / tool / decision / workflow |
| `key_pattern` | TEXT | 匹配触发词（归一化后的错误关键词） |
| `context` | TEXT | 原始错误消息或适用背景 |
| `cause` | TEXT | 根因或知识背景 |
| `content` | TEXT | 解决方案或知识内容 |
| `action_steps` | TEXT | 操作步骤（JSON 数组） |
| `title` | TEXT | 可选标题（非 bug 条目建议填写） |
| `language` | TEXT | 编程语言 |
| `project_type` | TEXT | 项目类型 |
| `tags` | TEXT | 逗号分隔标签 |
| `confidence` | INTEGER | 置信度 0-100 |
| `usage_count` | INTEGER | 使用次数 |
| `success_count` | INTEGER | 成功次数 |
| `status` | TEXT | active / deprecated / obsolete / archived |
| `replaced_by_id` | INTEGER | 被哪条记录替代 |
| `valid_for` | TEXT | 适用版本范围 |
| `deprecation_note` | TEXT | 废弃说明 |
| `consecutive_failures` | INTEGER | 连续失败次数 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

---

## 项目结构

```
plugins/bugdb-knowledge/
├── .claude-plugin/
│   └── plugin.json          # 插件元数据
├── bugdb/                    # Python 包（CLI + 数据库 + 搜索引擎）
│   ├── cli.py               # CLI 入口（所有外部调用的统一接口）
│   ├── db.py                # 数据访问层（Schema + CRUD + FTS5）
│   ├── models.py            # 数据模型（KnowledgeRecord, Category, EntryKind）
│   ├── search.py            # 搜索引擎（两轮策略 + 替代链）
│   ├── normalizer.py        # 错误消息归一化
│   ├── formatters.py        # 输出格式化（JSON / 纯文本）
│   ├── paths.py             # 路径解析（BUGDB_HOME / config.json）
│   ├── log.py               # 日志（rotating file + stderr）
│   ├── utils.py             # 工具函数
│   ├── exceptions.py        # 异常定义
│   └── tests/               # 测试套件（137 tests）
├── commands/
│   ├── bugdb-setup.md       # /bugdb-setup 一键配置命令
│   ├── bugfix.md            # /bugfix 斜杠命令
│   └── bugsearch.md         # /bugsearch 斜杠命令
├── docs/
│   └── MANUAL_INSTALL.md    # 手动安装指南
├── hooks/
│   ├── hooks.json           # Hook 注册（PostToolUse:Bash）
│   └── js/bugdb_check/
│       └── bugdb_check.js   # 错误检测 + 自动查库
├── skills/
│   ├── bugdb-lookup/
│   │   └── SKILL.md         # 查询知识库 Skill
│   └── bugdb-record/
│       └── SKILL.md         # 录入知识 Skill
├── pyproject.toml            # Python 包配置
└── README.md                 # 本文件
```

---

## 开发与测试

```bash
# 安装为可编辑包
cd plugins/bugdb-knowledge
pip install -e .

# 运行全部测试
pytest bugdb/tests/ -v

# 运行单个测试文件
pytest bugdb/tests/test_db.py -v

# 运行 e2e 测试
pytest bugdb/tests/test_e2e.py -v
```

---

## 协议

MIT
