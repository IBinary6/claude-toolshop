# /bugdb-setup — 一键完成插件配置

安装 bugdb-knowledge 插件后，执行此命令完成剩余配置。

## 前置依赖（用户机器上必须满足）

- **Python ≥ 3.11**，且 `python` 在 PATH 上能直接调起（不是 Windows Store stub、不是失效 shim）
- **pip 可用**（`python -m pip --version` 能输出版本）
- 写入 `~/.claude/CLAUDE.md`、`~/.claude/bugdb/` 的权限

不满足任一条会在 Step 0 被检测出来并停下，不会出现"装到一半烂在中间"的状态。

## 流程

按以下步骤依次执行，每步汇报结果。**前置检查不过必须停下提示用户修复，不得带病往后跑**。

### Step 0: 环境前置检查（任一不过立即停下）

#### 0.1 Python 可执行性

```bash
python --version
```

- 退出码非 0、出现 `0xffffffff` / `was not found` / `is not recognized` → PATH 上没有 Python，或指向失效 shim（常见于卸载残留的 chocolatey `python3.14.exe`、Windows Store stub `python.exe`）。
- 报告检测到的现象，给用户修复路径（任选其一），**不要替用户执行安装命令**：
  - Windows：`scoop install python`（推荐，自带 pip + Scripts 目录）/ `winget install Python.Python.3.11` / 从 https://www.python.org/downloads/ 下载，安装时勾选 "Add Python to PATH"
  - macOS：`brew install python@3.11`
  - Linux：发行版包管理器或 `pyenv install 3.11`
- Windows 失效 shim 残留 → 提示用户清理（如 `choco uninstall python3` 或手动删除指向不存在路径的 `.exe`），然后重跑 `/bugdb-setup`。

#### 0.2 Python 版本 ≥ 3.11

```bash
python -c "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}.{v.micro}'); assert v >= (3, 11), 'need >=3.11'"
```

- 失败 → 报告检测到的具体版本，按 0.1 渠道让用户升级。
- 插件依赖 3.11+ 语法，**不要建议改 `pyproject.toml` 降版本**，运行时会崩。

#### 0.3 pip 可用

```bash
python -m pip --version
```

- 失败 → 先试 `python -m ensurepip --upgrade`，仍失败则停下让用户修复。
- 全程用 `python -m pip` 而不是裸 `pip`，避免 PATH 上挂着失效 pip shim 的情况。

### Step 1: 安装 Python 包

```bash
python -m pip install -e "${CLAUDE_PLUGIN_ROOT}"
```

失败时按 stderr 报告，不要静默跳过。常见错误：
- `Package 'bugdb' requires a different Python` → 当前 python 实际版本 < 3.11，回 Step 0.2
- `Permission denied` / 写入系统目录失败 → 提示用户改用用户级 Python（scoop / 用户目录安装）而非系统 Python

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
  ✓ Python <版本> 已就绪
  ✓ Python 包已安装（pip install -e ${CLAUDE_PLUGIN_ROOT}）
  ✓ 数据库路径：<db_path>
  ✓ CLAUDE.md 触发规则已配置
  
  使用 /bugsearch <关键词> 搜索知识库
  使用 /bugfix 交互式录入知识条目
```

附加提示（独立信息，告知用户但不要阻塞）：

```
[提示] 直接在 shell 里敲 `bugdb` 命令需要 Python 的 Scripts/bin 目录在 PATH 上：
  - scoop python：H:\Scoop\apps\python\current\Scripts
  - python.org 安装：<install_dir>\Scripts
  - macOS/Linux：通常已在 PATH

skill / hook / 斜杠命令均通过 `python "${CLAUDE_PLUGIN_ROOT}/bugdb/cli.py" ...`
绝对路径调用，不依赖 PATH，可放心使用。
```

并附上**升级提示**（首次安装也输出，让用户知道未来怎么升级）：

```
后续插件升级（仓库发布了新 SKILL.md / hook / Python 代码时）：
  1. /plugin marketplace update claude-toolshop      # 拉最新代码到本地 cache
  2. 完全退出 Claude Code 再重新打开                  # 让 skill 元数据从磁盘重新加载
  
  仅 git pull 而不重启 Claude Code 不会生效——
  skill description / hook 配置在启动时加载到内存，运行期间不会重读。
```

## 约束

- 不得修改用户 CLAUDE.md 中已有的内容
- 追加时必须在文件末尾，用空行分隔
- 任何步骤失败必须明确报告，不得静默跳过
- **不得替用户执行系统级安装命令**（`scoop install`、`winget install`、`brew install` 等），只汇报检测结果与修复路径，等用户自己装完再让用户重跑 `/bugdb-setup`
- **不得为了"绕开版本检查"而修改插件 `pyproject.toml` 或 `requires-python`**，会留下运行时崩溃隐患
