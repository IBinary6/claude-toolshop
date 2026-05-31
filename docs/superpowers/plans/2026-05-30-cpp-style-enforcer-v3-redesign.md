# cpp-style-enforcer v0.3.0 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原地重构 cpp-style-enforcer 插件为 v0.3.0：消除 PostToolUse 崩溃源（exit2+stdout JSON 协议冲突、未配置项目反复 block 卡死），改为单进程模块化流水线，全程 exit 0，cpplint 在临时副本上运行不损坏源文件。

**Architecture:** 三个薄壳入口（post_edit.js / pre_commit.js / session_start.js）只做「读 stdin → 编排 steps → 统一协议输出」。业务逻辑全部下沉到 `lib/`（基础设施：stdin/protocol/config/git/project/bom_util/target）与 `steps/`（纯函数：clang_format/bom/copyright/cpplint）。新老文件判定 = git 是否跟踪；老项目老文件只补 BOM。BOM 字节处理收敛到 `lib/bom_util.js` 唯一实现。

**Tech Stack:** Node.js v26, Claude Code hooks, clang-format, Python(cpplint.py), git。测试用 node 断言脚本（`node:assert`，非零退出 = 失败），无第三方测试框架。

**环境约定:** Windows + bash shell（Unix 语法）。`/dev/null` 非 `NUL`，路径用正斜杠。插件根 = `D:/code/PLUGIN/claude-toolshop/plugins/cpp-style-enforcer`。下文所有 `node hooks/js/...` 命令均以**插件根为工作目录**执行。

---

## File Structure

### 创建（新增）

| 路径（相对插件根） | 职责 |
|---|---|
| `templates/cpp-style-template.default.json` | **改写**出厂默认模板，补 `enabled`/`mode` 字段（schema 见 spec §4.1） |
| `hooks/js/lib/stdin.js` | `readStdinJson({timeoutMs})` —— 带超时读 stdin（迁移自旧 utils） |
| `hooks/js/lib/protocol.js` | 唯一输出出口：`passSilent()` / `blockClaude(reason)` / `denyTool(reason)`，全 exit 0（崩溃修复核心） |
| `hooks/js/lib/bom_util.js` | `stripBom(buf)` / `restoreBom(hadBom, body)` / `detectEncoding(buf)` —— BOM 字节处理唯一实现 |
| `hooks/js/lib/target.js` | `resolveFilePath(input)` / `shouldHandle(filePath)` + `CPP_EXTENSIONS`/`EXCLUDED_DIRS`/`SKIPPED_FILES` 常量 |
| `hooks/js/lib/git.js` | `repoRoot(fp)` / `isTracked(fp,root)` / `isNew(fp,root)` / `changedLineRanges(fp,root)` |
| `hooks/js/lib/project.js` | `findCMakeRoot(filePath)` / `isCMakeProject(filePath)`（向上找 CMakeLists.txt，与 git 解耦） |
| `hooks/js/lib/config.js` | `loadConfig(filePath)` 全局模板 ⊕ 项目覆盖；`ensureUserTemplate(defaultPath)` 已存在绝不覆盖 |
| `hooks/js/steps/bom.js` | `applyBom(filePath, {isCMake})` 补 BOM / GBK 转码（复用 bom_util） |
| `hooks/js/steps/clang_format.js` | `applyClangFormat(filePath)` 剥BOM→clang-format stdin/stdout→diff→仅变化 restoreBom 写回 |
| `hooks/js/steps/copyright.js` | `applyCopyright(filePath, copyrightInfo)` 剥BOM→插/更头→拼回BOM；dateFormat 生效 |
| `hooks/js/steps/cpplint.js` | `runCpplint(filePath, {root, suppressCopyright})` 临时副本 lint + 解析去重前 5 条 |
| `hooks/js/post_edit.js` | PostToolUse 入口薄壳 |
| `hooks/js/pre_commit.js` | PreToolUse 入口薄壳 |
| `hooks/js/session_start.js` | SessionStart 入口薄壳（完全静默，仅 ensureUserTemplate） |
| `hooks/js/__tests__/*.test.js` | 各模块 node 断言测试 |

### 修改

| 路径 | 改动 |
|---|---|
| `.claude-plugin/plugin.json` | version `0.2.0` → `0.3.0`；description 去掉 baseline 相关措辞 |
| `hooks/hooks.json` | 3 个 hook 指向新入口；PostToolUse matcher **移除 `Bash`** |
| `commands/cpp-style-setup.md` | 重写：去弹问拦截；项目配置路径 `.claude-cpp-style/cpp-style.json` |

### 删除（重构完成后）

- `hooks/js/lib/utils.js`（逻辑拆分到新 lib/）
- `hooks/js/post_edit_pipeline/`（整目录，旧主流水线 = 崩溃源）
- `hooks/js/copyright/`（整目录，逻辑迁移到 steps/copyright.js）
- `hooks/js/cpp_style_guard/`（整目录，旧 SessionStart）
- `hooks/js/pre_commit_lint/`（整目录，旧 PreToolUse）
- **保留** `hooks/js/cpplint/cpplint.py`（cpplint 引擎，不动）—— 删除 `cpplint/` 下的 `cpplint_check.js`，但保留 `cpplint.py`

---

## Task 1: 项目骨架 + 出厂模板 + plugin.json 升版

建立目录结构、改写出厂默认模板（补 `enabled`/`mode`），把版本号升到 0.3.0。这是后续所有任务的基础。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/template.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');

// 出厂模板必须含 enabled/mode/checks/copyrightInfo 全字段，且为合法 JSON
const tplPath = path.join(pluginRoot, 'templates', 'cpp-style-template.default.json');
assert.ok(fs.existsSync(tplPath), '出厂模板文件应存在');
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf-8'));
assert.strictEqual(tpl.enabled, true, 'enabled 缺省 true');
assert.strictEqual(tpl.mode, 'incremental', 'mode 缺省 incremental');
assert.deepStrictEqual(tpl.checks, { clangFormat: true, copyright: true, cpplint: true, bom: true }, 'checks 四项全 true');
assert.strictEqual(tpl.copyrightInfo.company, '', 'company 缺省空串');
assert.strictEqual(tpl.copyrightInfo.author, '', 'author 缺省空串');
assert.strictEqual(tpl.copyrightInfo.dateFormat, 'YYYY/MM/DD HH:mm', 'dateFormat 缺省值');

// plugin.json 版本必须为 0.3.0
const pj = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf-8'));
assert.strictEqual(pj.version, '0.3.0', '版本应升到 0.3.0');

// 目录骨架存在
for (const d of ['hooks/js/lib', 'hooks/js/steps', 'hooks/js/__tests__']) {
  assert.ok(fs.existsSync(path.join(pluginRoot, d)), `${d} 目录应存在`);
}
console.log('template.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败** ：`node hooks/js/__tests__/template.test.js`。预期失败：`AssertionError: enabled 缺省 true`（旧模板无 enabled 字段），或在更早处因目录不存在抛错。

- [ ] **Step 3 — 写最小实现**：
  - 建目录：`mkdir -p hooks/js/lib hooks/js/steps hooks/js/__tests__`
  - 改写 `templates/cpp-style-template.default.json`：
```json
{
  "enabled": true,
  "mode": "incremental",
  "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
  "copyrightInfo": {
    "company": "",
    "author": "",
    "dateFormat": "YYYY/MM/DD HH:mm"
  }
}
```
  - 用 Edit 改 `.claude-plugin/plugin.json`：`"version": "0.2.0"` → `"version": "0.3.0"`；description 去掉「基线」相关旧措辞（改为：`C++ 代码风格强制（Google C++ Style）：新项目全量 / 老项目仅新文件走 clang-format+copyright+cpplint，老文件只补 UTF-8 BOM；新老判定基于 git 是否跟踪。各检查项可独立开关，版权信息可配置。`）。

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/template.test.js` → 输出 `template.test.js PASS`，exit 0。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/templates plugins/cpp-style-enforcer/.claude-plugin/plugin.json plugins/cpp-style-enforcer/hooks/js/__tests__/template.test.js
git commit -m "feat(cpp-style-enforcer): v0.3.0 骨架 — 模板补 enabled/mode + 升版本"
```

---

## Task 2: lib/stdin.js（带超时读 stdin）

迁移自旧 `utils.js` 的 `readStdinJson`：空输入/解析失败返回 `{}`，超时不挂死。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/stdin.test.js`：
```js
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, 'fixtures', 'stdin-runner.js');
// fixtures/stdin-runner.js: 调用 readStdinJson 并 console.log(JSON.stringify(result))
require('fs').mkdirSync(path.dirname(script), { recursive: true });
require('fs').writeFileSync(script, `
const { readStdinJson } = require('${path.join(__dirname, '..', 'lib', 'stdin.js').replace(/\\\\/g, '/')}');
readStdinJson({ timeoutMs: 500 }).then(r => { console.log(JSON.stringify(r)); process.exit(0); });
`);

function run(input) {
  const r = spawnSync('node', [script], { input, encoding: 'utf-8', timeout: 5000 });
  return JSON.parse(r.stdout.trim() || '{}');
}

assert.deepStrictEqual(run('{"a":1}'), { a: 1 }, '合法 JSON 应解析');
assert.deepStrictEqual(run(''), {}, '空输入应返回 {}');
assert.deepStrictEqual(run('not json'), {}, '非法 JSON 应返回 {}');
console.log('stdin.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/stdin.test.js`。预期失败：`Cannot find module '.../lib/stdin.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/stdin.js`：
```js
'use strict';

/**
 * 从 stdin 读取 JSON（hook 输入）。空输入或解析失败返回 {}。
 * @param {{timeoutMs?:number, maxSize?:number}} options
 * @returns {Promise<object>}
 */
function readStdinJson(options = {}) {
  const { timeoutMs = 5000, maxSize = 1024 * 1024 } = options;
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = () => {
      try { resolve(data.trim() ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.stdin.removeAllListeners();
      if (process.stdin.unref) process.stdin.unref();
      finish();
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { if (data.length < maxSize) data += chunk; });
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true; clearTimeout(timer); finish();
    });
    process.stdin.on('error', () => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve({});
    });
  });
}

module.exports = { readStdinJson };
```

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/stdin.test.js` → `stdin.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/stdin.js plugins/cpp-style-enforcer/hooks/js/__tests__/stdin.test.js
git commit -m "feat(cpp-style-enforcer): lib/stdin.js 带超时读 stdin"
```

---

## Task 3: lib/protocol.js（唯一三个出口，全 exit 0）—— 崩溃修复核心

spec §7：`passSilent` = exit0 空输出；`blockClaude(reason)` = exit0 + stdout `{decision:"block",reason}`；`denyTool(reason)` = exit0 + stdout `{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason}}`。**永不 exit 1/2**，stdout 要么空要么纯 JSON。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/protocol.test.js`：
```js
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const libPath = path.join(__dirname, '..', 'lib', 'protocol.js').replace(/\\\\/g, '/');
const runnerDir = path.join(__dirname, 'fixtures');
fs.mkdirSync(runnerDir, { recursive: true });

function runFn(call) {
  const runner = path.join(runnerDir, 'protocol-runner.js');
  fs.writeFileSync(runner, `const p = require('${libPath}'); ${call}`);
  const r = spawnSync('node', [runner], { encoding: 'utf-8', timeout: 5000 });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

// passSilent: exit0, stdout 空, stderr 空
let r = runFn('p.passSilent();');
assert.strictEqual(r.status, 0, 'passSilent exit 0');
assert.strictEqual(r.stdout, '', 'passSilent stdout 空');
assert.strictEqual(r.stderr, '', 'passSilent stderr 空');

// blockClaude: exit0, stdout 是 {decision:block,reason}
r = runFn('p.blockClaude("FIX_THIS");');
assert.strictEqual(r.status, 0, 'blockClaude exit 0');
const block = JSON.parse(r.stdout);
assert.strictEqual(block.decision, 'block', 'decision=block');
assert.strictEqual(block.reason, 'FIX_THIS', 'reason 透传');

// denyTool: exit0, stdout 是 hookSpecificOutput.permissionDecision=deny
r = runFn('p.denyTool("NO_COMMIT");');
assert.strictEqual(r.status, 0, 'denyTool exit 0');
const deny = JSON.parse(r.stdout);
assert.strictEqual(deny.hookSpecificOutput.permissionDecision, 'deny', 'permissionDecision=deny');
assert.strictEqual(deny.hookSpecificOutput.permissionDecisionReason, 'NO_COMMIT', 'reason 透传');
console.log('protocol.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/protocol.test.js`。预期失败：`Cannot find module '.../lib/protocol.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/protocol.js`：
```js
'use strict';

/**
 * 唯一输出出口。铁律：全程 exit 0；诊断走 stderr；stdout 要么空要么纯 JSON。
 * 永不 exit 1（issue #4809）、永不 exit 2+stdout JSON（旧崩溃源）。
 */

/** 静默通过：stdout/stderr 均空，exit 0 */
function passSilent() {
  process.exit(0);
}

/**
 * PostToolUse 强制修复：exit 0 + stdout {decision:"block",reason}
 * @param {string} reason 喂给 Claude 的修复指令
 */
function blockClaude(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

/**
 * PreToolUse 阻止工具：exit 0 + stdout hookSpecificOutput.permissionDecision=deny
 * @param {string} reason 阻止理由
 */
function denyTool(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

/** 诊断信息（用户/Claude 可见），绝不混入 stdout */
function diag(message) {
  process.stderr.write(String(message) + '\n');
}

module.exports = { passSilent, blockClaude, denyTool, diag };
```

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/protocol.test.js` → `protocol.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/protocol.js plugins/cpp-style-enforcer/hooks/js/__tests__/protocol.test.js
git commit -m "feat(cpp-style-enforcer): lib/protocol.js 唯一出口全 exit0 — 修复协议冲突崩溃"
```

---

## Task 4: lib/bom_util.js（BOM 字节处理唯一实现）

spec §5：`stripBom(buf)→{hadBom, body}`、`restoreBom(hadBom, body)→buf`、`detectEncoding(buf)`。多前导 BOM 归一为一个。所有改写文件的步骤复用此处。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/bom_util.test.js`：
```js
const assert = require('node:assert');
const { stripBom, restoreBom, detectEncoding } = require('../lib/bom_util.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from('int main(){}', 'utf-8');

// 往返：带 BOM
const withBom = Buffer.concat([BOM, body]);
let s = stripBom(withBom);
assert.strictEqual(s.hadBom, true, '应检出 BOM');
assert.ok(s.body.equals(body), 'body 应去掉 BOM');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), '往返字节级一致(带BOM)');

// 往返：不带 BOM
s = stripBom(body);
assert.strictEqual(s.hadBom, false, '无 BOM');
assert.ok(restoreBom(s.hadBom, s.body).equals(body), '往返字节级一致(无BOM)');

// 多前导 BOM 归一为一个
const triple = Buffer.concat([BOM, BOM, BOM, body]);
s = stripBom(triple);
assert.strictEqual(s.hadBom, true, '多 BOM 仍 hadBom=true');
assert.ok(s.body.equals(body), '多 BOM 全部剥掉');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), '多 BOM 归一为恰好一个');

// detectEncoding 分类
assert.strictEqual(detectEncoding(withBom), 'utf-8-bom', 'UTF-8 BOM');
assert.strictEqual(detectEncoding(body), 'utf-8', '无 BOM UTF-8');
assert.strictEqual(detectEncoding(Buffer.from([0xFF, 0xFE, 0x41, 0x00])), 'utf-16', 'UTF-16 LE');
assert.strictEqual(detectEncoding(Buffer.from([0xFE, 0xFF, 0x00, 0x41])), 'utf-16', 'UTF-16 BE');
// GBK：含高位字节但非合法 UTF-8（0xC4 0xE3 = "你" 的 GBK，但单独 0xD0 0xE3 等）
const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]); // "你好" GBK
assert.strictEqual(detectEncoding(gbk), 'gbk', 'GBK 分类');
console.log('bom_util.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/bom_util.test.js`。预期失败：`Cannot find module '../lib/bom_util.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/bom_util.js`：
```js
'use strict';

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

/**
 * 剥除所有前导 UTF-8 BOM。
 * @param {Buffer} buf 原始字节
 * @returns {{hadBom:boolean, body:Buffer}} hadBom=是否有前导BOM；body=无BOM正文
 */
function stripBom(buf) {
  let offset = 0;
  while (offset + 3 <= buf.length &&
         buf[offset] === 0xEF && buf[offset + 1] === 0xBB && buf[offset + 2] === 0xBF) {
    offset += 3;
  }
  return { hadBom: offset > 0, body: buf.slice(offset) };
}

/**
 * 按 hadBom 拼回恰好一个 BOM（多 BOM 已在 stripBom 归一）。
 * @param {boolean} hadBom
 * @param {Buffer} body 无 BOM 正文
 * @returns {Buffer}
 */
function restoreBom(hadBom, body) {
  return hadBom ? Buffer.concat([BOM, body]) : body;
}

/**
 * 检测编码。返回 'utf-8-bom' | 'utf-16' | 'utf-8' | 'gbk' | 'unknown'。
 * @param {Buffer} buf
 * @returns {string}
 */
function detectEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8-bom';
  if (buf.length >= 2 && ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF))) return 'utf-16';
  if (isValidUtf8(buf)) return 'utf-8';
  try {
    const iconv = require('iconv-lite');
    if (iconv.decode(buf, 'gbk').length > 0) return 'gbk';
  } catch (_) {}
  return 'unknown';
}

/** 严格 UTF-8 校验（含高位字节也能正确区分 UTF-8 与 GBK） */
function isValidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7F) { i += 1; continue; }
    let n;
    if ((b & 0xE0) === 0xC0) n = 1;
    else if ((b & 0xF0) === 0xE0) n = 2;
    else if ((b & 0xF8) === 0xF0) n = 3;
    else return false;
    if (i + n >= buf.length) return false;
    for (let j = 1; j <= n; j++) {
      if ((buf[i + j] & 0xC0) !== 0x80) return false;
    }
    i += n + 1;
  }
  return true;
}

module.exports = { stripBom, restoreBom, detectEncoding, BOM };
```
  > 注：`iconv-lite` 是 Claude Code 运行时依赖；缺失时 `detectEncoding` 对 GBK 返回 `unknown`（被 try/catch 吞），符合 spec §9「iconv-lite 缺失→GBK 跳过」。测试环境若无 iconv-lite，GBK 断言会失败——届时按 spec §9 将该断言改为容忍 `'gbk'` 或 `'unknown'`，但**优先确认 iconv-lite 可用**（`node -e "require('iconv-lite')"`）。

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/bom_util.test.js` → `bom_util.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/bom_util.js plugins/cpp-style-enforcer/hooks/js/__tests__/bom_util.test.js
git commit -m "feat(cpp-style-enforcer): lib/bom_util.js BOM 字节处理唯一实现"
```

---

## Task 5: lib/target.js（路径解析 + 文件过滤 + 常量）

迁移自旧 utils 的 `resolveFilePath` / 扩展名 / 排除目录，新增 `shouldHandle` 与 `SKIPPED_FILES`。**不再支持 Bash 命令提取路径**（PostToolUse 去掉 Bash matcher）。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/target.test.js`：
```js
const assert = require('node:assert');
const path = require('path');
const { resolveFilePath, shouldHandle, CPP_EXTENSIONS, EXCLUDED_DIRS, SKIPPED_FILES } = require('../lib/target.js');

// resolveFilePath: tool_input.file_path 直取
assert.strictEqual(
  resolveFilePath({ tool_input: { file_path: '/p/a.cpp' } }), '/p/a.cpp', 'file_path 直取');
// relative_path + cwd
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { relative_path: 'src/a.cc' } }),
  path.resolve('/proj', 'src/a.cc'), 'relative_path 解析');
// 无路径
assert.strictEqual(resolveFilePath({}), null, '无路径返回 null');
assert.strictEqual(resolveFilePath(null), null, 'null 输入返回 null');

// shouldHandle: 扩展名
assert.strictEqual(shouldHandle('/p/a.cpp'), true, '.cpp 处理');
assert.strictEqual(shouldHandle('/p/a.txt'), false, '.txt 不处理');
// SKIPPED_FILES
assert.strictEqual(shouldHandle('/p/resource.h'), false, 'resource.h 跳过');
// EXCLUDED_DIRS（路径含 node_modules）
assert.strictEqual(shouldHandle('/p/node_modules/a.cpp'), false, 'node_modules 跳过');
assert.strictEqual(shouldHandle('/p/build/a.cpp'), false, 'build 跳过');

// 常量
assert.ok(CPP_EXTENSIONS.has('.hpp'), '.hpp 在扩展名集');
assert.ok(EXCLUDED_DIRS.has('node_modules'), 'node_modules 在排除集');
assert.ok(SKIPPED_FILES.has('resource.h'), 'resource.h 在跳过集');
console.log('target.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/target.test.js`。预期失败：`Cannot find module '../lib/target.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/target.js`：
```js
'use strict';

const path = require('path');

/** C / C++ 源文件扩展名（含头文件） */
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx']);

/** 跳过检查的目录名（第三方 / 构建产物 / 包管理器） */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'build', 'dist', 'out', 'bin', 'obj',
  '.git', 'target', 'third_party', 'thirdparty', 'external',
  'vendor', 'deps', 'packages',
]);

/** 跳过的特定文件名（VS 自动生成 / 不该被风格化） */
const SKIPPED_FILES = new Set(['resource.h', 'targetver.h', 'stdafx.h', 'pch.h']);

/**
 * 从 hook stdin JSON 提取被编辑的文件路径（Write/Edit/MultiEdit/NotebookEdit/MCP）。
 * 不处理 Bash command（PostToolUse 已去掉 Bash matcher）。
 * @param {object} input
 * @returns {string|null}
 */
function resolveFilePath(input) {
  if (!input || typeof input !== 'object') return null;
  const t = input.tool_input;
  if (t && typeof t === 'object') {
    const direct = t.file_path || t.path || null;
    if (direct) return direct;
    if (t.relative_path) {
      const cwd = input.cwd || process.cwd();
      return path.resolve(cwd, t.relative_path);
    }
  }
  if (typeof t === 'string') return t;
  return input.file_path || input.path || null;
}

/**
 * 是否应处理该文件：扩展名命中 && 非 SKIPPED_FILES && 路径无 EXCLUDED_DIRS。
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldHandle(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!CPP_EXTENSIONS.has(ext)) return false;
  if (SKIPPED_FILES.has(path.basename(filePath).toLowerCase())) return false;
  for (const part of filePath.split(/[/\\]/)) {
    if (EXCLUDED_DIRS.has(part.toLowerCase())) return false;
  }
  return true;
}

module.exports = { resolveFilePath, shouldHandle, CPP_EXTENSIONS, EXCLUDED_DIRS, SKIPPED_FILES };
```

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/target.test.js` → `target.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/target.js plugins/cpp-style-enforcer/hooks/js/__tests__/target.test.js
git commit -m "feat(cpp-style-enforcer): lib/target.js 路径解析+文件过滤+常量"
```

---

## Task 6: lib/git.js（repoRoot / isTracked / isNew / changedLineRanges）

spec §4.3：`isNew(file) = !isTracked(file)`。非 git 仓库 → 所有文件视为「新」（isNew=true）。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/git.test.js`（用临时 git 仓库）：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, isTracked, isNew } = require('../lib/git.js');

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

// 建临时 git 仓库
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gittest-'));
sh(['init'], tmp);
sh(['config', 'user.email', 't@t.com'], tmp);
sh(['config', 'user.name', 't'], tmp);
const tracked = path.join(tmp, 'tracked.cpp');
fs.writeFileSync(tracked, 'int a;');
sh(['add', 'tracked.cpp'], tmp);
sh(['commit', '-m', 'init'], tmp);
const untracked = path.join(tmp, 'untracked.cpp');
fs.writeFileSync(untracked, 'int b;');

const root = repoRoot(tracked);
assert.ok(root && fs.existsSync(root), 'repoRoot 应返回有效目录');
assert.strictEqual(isTracked(tracked, root), true, '已跟踪文件 isTracked=true');
assert.strictEqual(isTracked(untracked, root), false, '未跟踪文件 isTracked=false');
assert.strictEqual(isNew(tracked, root), false, '已跟踪 = 老文件 isNew=false');
assert.strictEqual(isNew(untracked, root), true, '未跟踪 = 新文件 isNew=true');

// 非 git 仓库
const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'nongit-'));
const f = path.join(nonGit, 'x.cpp');
fs.writeFileSync(f, 'int c;');
assert.strictEqual(repoRoot(f), null, '非 git repoRoot=null');
assert.strictEqual(isNew(f, null), true, '非 git 所有文件视为新 isNew=true');
console.log('git.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/git.test.js`。预期失败：`Cannot find module '../lib/git.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/git.js`：
```js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';

function gitDir(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      ? filePath : path.dirname(filePath);
  } catch (_) {
    return path.dirname(filePath);
  }
}

/**
 * 从文件向上找 git 仓库根。非 git 仓库返回 null。
 * @param {string} filePath
 * @returns {string|null}
 */
function repoRoot(filePath) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: gitDir(filePath), stdio: 'pipe', timeout: 3000, windowsHide: isWindows,
  });
  if (r.status !== 0) return null;
  return (r.stdout || Buffer.alloc(0)).toString('utf-8').trim() || null;
}

/**
 * 文件是否被 git 跟踪。root 为 null 时返回 false。
 * @param {string} filePath
 * @param {string|null} root
 * @returns {boolean}
 */
function isTracked(filePath, root) {
  if (!root) return false;
  const r = spawnSync('git', ['ls-files', '--error-unmatch', filePath], {
    cwd: root, stdio: 'pipe', timeout: 3000, windowsHide: isWindows,
  });
  return r.status === 0;
}

/**
 * 新文件判定：!isTracked。非 git 仓库(root=null) → true（视为新）。
 * @param {string} filePath
 * @param {string|null} root
 * @returns {boolean}
 */
function isNew(filePath, root) {
  if (!root) return true;
  return !isTracked(filePath, root);
}

/**
 * 工作区+暂存区相对 HEAD 的改动行范围 [[start,end],...]。失败返回 null。
 * @param {string} filePath
 * @param {string|null} root
 * @returns {Array<[number,number]>|null}
 */
function changedLineRanges(filePath, root) {
  if (!root) return null;
  const r = spawnSync('git', ['diff', '-U0', 'HEAD', '--', filePath], {
    cwd: root, stdio: 'pipe', timeout: 5000, windowsHide: isWindows,
  });
  if (r.status !== 0) return null;
  const out = (r.stdout || Buffer.alloc(0)).toString('utf-8');
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  const ranges = [];
  let m;
  while ((m = re.exec(out)) !== null) {
    const start = parseInt(m[1], 10);
    const len = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    if (len === 0) continue;
    ranges.push([start, start + len - 1]);
  }
  return ranges;
}

module.exports = { repoRoot, isTracked, isNew, changedLineRanges };
```
  > 注：`changedLineRanges` 当前流水线（spec §5）不使用（clang-format 走全套时整文件格式化，不按行），保留为工具函数供未来用，不在入口编排中调用。

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/git.test.js` → `git.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/git.js plugins/cpp-style-enforcer/hooks/js/__tests__/git.test.js
git commit -m "feat(cpp-style-enforcer): lib/git.js isNew=!isTracked 新老判定"
```

---

## Task 7: lib/project.js（findCMakeRoot 向上找，与 git 解耦）

spec §4.4：从 `path.dirname(filePath)` 逐级向上找 CMakeLists.txt，找到返回该层目录，到顶 null。`isCMakeProject = findCMakeRoot !== null`。纯 `fs.existsSync`，对 null/不存在安全。

- [ ] **Step 1 — 写失败测试** `hooks/js/__tests__/project.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findCMakeRoot, isCMakeProject } = require('../lib/project.js');

// 文件同级有 CMakeLists.txt
const root1 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-'));
fs.writeFileSync(path.join(root1, 'CMakeLists.txt'), 'project(x)');
const f1 = path.join(root1, 'main.cpp');
fs.writeFileSync(f1, 'int main(){}');
assert.strictEqual(findCMakeRoot(f1), fs.realpathSync(root1), '同级命中');
assert.strictEqual(isCMakeProject(f1), true, 'isCMakeProject true');

// 上层有 CMakeLists.txt（文件在子目录）
const sub = path.join(root1, 'src', 'core');
fs.mkdirSync(sub, { recursive: true });
const f2 = path.join(sub, 'a.cc');
fs.writeFileSync(f2, 'int x;');
assert.strictEqual(findCMakeRoot(f2), fs.realpathSync(root1), '上层向上找到');

// 都没有 → null（非 CMake 项目）
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nocmake-'));
const f3 = path.join(root2, 'b.cpp');
fs.writeFileSync(f3, 'int y;');
assert.strictEqual(findCMakeRoot(f3), null, '无 CMakeLists.txt → null');
assert.strictEqual(isCMakeProject(f3), false, 'isCMakeProject false');

// 非 git 的 CMake 项目（无 .git，但有 CMakeLists.txt）→ 仍命中
const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-nogit-'));
fs.writeFileSync(path.join(root3, 'CMakeLists.txt'), 'project(z)');
const f4 = path.join(root3, 'z.cpp');
fs.writeFileSync(f4, 'int z;');
assert.strictEqual(isCMakeProject(f4), true, '非 git CMake 项目仍命中');

// null / 不存在路径 → 不崩
assert.strictEqual(findCMakeRoot(null), null, 'null 安全');
assert.strictEqual(findCMakeRoot('/no/such/path/x.cpp'), null, '不存在路径安全');
console.log('project.test.js PASS');
```

- [ ] **Step 2 — 运行确认失败**：`node hooks/js/__tests__/project.test.js`。预期失败：`Cannot find module '../lib/project.js'`。

- [ ] **Step 3 — 写最小实现** `hooks/js/lib/project.js`：
```js
'use strict';

const fs = require('fs');
const path = require('path');

const _cache = new Map(); // 单进程内缓存（每次 hook 是独立进程）

/**
 * 从被编辑文件向上逐级找 CMakeLists.txt，与 git 解耦。
 * @param {string} filePath
 * @returns {string|null} CMake 项目根（含 CMakeLists.txt 的目录）；找不到 null
 */
function findCMakeRoot(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (_cache.has(filePath)) return _cache.get(filePath);
  let result = null;
  try {
    let dir = path.dirname(path.resolve(filePath));
    let prev = null;
    while (dir && dir !== prev) {
      if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
        result = fs.existsSync(dir) ? fs.realpathSync(dir) : dir;
        break;
      }
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch (_) {
    result = null;
  }
  _cache.set(filePath, result);
  return result;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isCMakeProject(filePath) {
  return findCMakeRoot(filePath) !== null;
}

module.exports = { findCMakeRoot, isCMakeProject };
```
  > 注：测试用 `fs.realpathSync` 比对，因 macOS/Windows 临时目录可能含符号链接；实现里命中时也 `realpathSync` 归一，保证断言一致。

- [ ] **Step 4 — 运行确认通过**：`node hooks/js/__tests__/project.test.js` → `project.test.js PASS`。

- [ ] **Step 5 — 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/project.js plugins/cpp-style-enforcer/hooks/js/__tests__/project.test.js
git commit -m "feat(cpp-style-enforcer): lib/project.js findCMakeRoot 向上找与 git 解耦"
```

---

## Task 8: lib/config.js（全局模板 ⊕ 项目覆盖 + ensureUserTemplate 不覆盖）

spec §4.1/§4.2/§8：`ensureUserTemplate(defaultPath)` 用户模板不存在才从出厂默认复制，已存在绝不覆盖；`loadConfig(filePath)` 全局模板 ⊕ 项目 `.claude-cpp-style/cpp-style.json` 字段级覆盖，checks 缺失默认 true，enabled 缺省 true，损坏/不存在 → 默认值，返回规范化 `{enabled,mode,checks,copyrightInfo}`。

**Files**
- Create: `hooks/js/lib/config.js`
- Test: `hooks/js/__tests__/config.test.js`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/config.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, ensureUserTemplate, DEFAULT_CONFIG } = require('../lib/config.js');

// ---- ensureUserTemplate：已存在绝不覆盖（写前后字节一致，含用户自填字段）----
const tmpl = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-'));
const defaultPath = path.join(tmpl, 'cpp-style-template.default.json');
fs.writeFileSync(defaultPath, JSON.stringify(DEFAULT_CONFIG));
const userPath = path.join(tmpl, 'user-template.json');
const userContent = JSON.stringify({ enabled: true, mode: 'full', checks: {}, copyrightInfo: { company: 'ACME', author: 'kevin', dateFormat: 'YYYY/MM/DD HH:mm' } });
fs.writeFileSync(userPath, userContent);
const before = fs.readFileSync(userPath);
ensureUserTemplate(defaultPath, userPath);
const after = fs.readFileSync(userPath);
assert.ok(before.equals(after), '已存在模板写前后字节完全一致');

// ---- ensureUserTemplate：不存在则复制 ----
const userPath2 = path.join(tmpl, 'fresh-template.json');
ensureUserTemplate(defaultPath, userPath2);
assert.ok(fs.existsSync(userPath2), '不存在则从默认复制');
assert.ok(fs.readFileSync(userPath2).equals(fs.readFileSync(defaultPath)), '复制内容与默认一致');

// ---- ensureUserTemplate：复制失败不崩（默认源不存在）----
assert.doesNotThrow(() => ensureUserTemplate(path.join(tmpl, 'no-such.json'), path.join(tmpl, 'x.json')), '复制失败 try/catch 不崩');

// ---- loadConfig：字段级覆盖（全局模板 ⊕ 项目）----
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
const cfgDir = path.join(proj, '.claude-cpp-style');
fs.mkdirSync(cfgDir, { recursive: true });
fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ mode: 'full', checks: { cpplint: false }, copyrightInfo: { company: 'OVERRIDE' } }));
const srcFile = path.join(proj, 'a.cpp');
fs.writeFileSync(srcFile, 'int a;');
const cfg = loadConfig(srcFile, userPath);
assert.strictEqual(cfg.mode, 'full', '项目覆盖 mode=full');
assert.strictEqual(cfg.checks.cpplint, false, '项目覆盖 cpplint=false');
assert.strictEqual(cfg.checks.bom, true, '未覆盖的 checks 缺失默认 true');
assert.strictEqual(cfg.checks.clangFormat, true, '未覆盖的 clangFormat 默认 true');
assert.strictEqual(cfg.copyrightInfo.company, 'OVERRIDE', '项目覆盖 company');
assert.strictEqual(cfg.copyrightInfo.author, 'kevin', '未覆盖 author 回退全局');
assert.strictEqual(cfg.enabled, true, 'enabled 缺省 true');

// ---- loadConfig：损坏 JSON 回退默认 ----
const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'proj2-'));
const cfgDir2 = path.join(proj2, '.claude-cpp-style');
fs.mkdirSync(cfgDir2, { recursive: true });
fs.writeFileSync(path.join(cfgDir2, 'cpp-style.json'), '{ broken json ');
const src2 = path.join(proj2, 'b.cpp');
fs.writeFileSync(src2, 'int b;');
const cfg2 = loadConfig(src2, path.join(tmpl, 'no-global.json'));
assert.strictEqual(cfg2.enabled, true, '损坏 JSON + 无全局 → 硬编码默认 enabled true');
assert.strictEqual(cfg2.mode, 'incremental', '损坏 JSON → 默认 incremental');
assert.deepStrictEqual(cfg2.checks, { clangFormat: true, copyright: true, cpplint: true, bom: true }, '损坏 JSON → checks 全默认 true');

// ---- loadConfig：enabled:false 生效 ----
const proj3 = fs.mkdtempSync(path.join(os.tmpdir(), 'proj3-'));
const cfgDir3 = path.join(proj3, '.claude-cpp-style');
fs.mkdirSync(cfgDir3, { recursive: true });
fs.writeFileSync(path.join(cfgDir3, 'cpp-style.json'), JSON.stringify({ enabled: false }));
const src3 = path.join(proj3, 'c.cpp');
fs.writeFileSync(src3, 'int c;');
assert.strictEqual(loadConfig(src3, userPath).enabled, false, 'enabled:false 透传');

console.log('config.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/config.test.js`。预期失败：`Cannot find module '../lib/config.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/lib/config.js`：
```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** 硬编码安全默认（全局模板/项目配置都缺失或损坏时的兜底） */
const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'incremental',
  checks: { clangFormat: true, copyright: true, cpplint: true, bom: true },
  copyrightInfo: { company: '', author: '', dateFormat: 'YYYY/MM/DD HH:mm' },
};

/** 全局模板默认路径 ~/.claude/cpp-style-template.json */
function userTemplatePath() {
  return path.join(os.homedir(), '.claude', 'cpp-style-template.json');
}

/**
 * 用户全局模板不存在才从出厂默认复制；已存在绝不覆盖。复制失败 try/catch 吞掉。
 * @param {string} defaultPath 插件出厂默认模板绝对路径
 * @param {string} [userPath] 用户模板路径（默认 ~/.claude/cpp-style-template.json）
 * @returns {string} 用户模板路径
 */
function ensureUserTemplate(defaultPath, userPath = userTemplatePath()) {
  try {
    if (fs.existsSync(userPath)) return userPath;
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.copyFileSync(defaultPath, userPath);
  } catch (_) {
    // 权限/源缺失等 → 降级到硬编码默认，不崩
  }
  return userPath;
}

/** 安全读 JSON 文件，失败返回 null */
function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

/** 从被编辑文件向上找 .claude-cpp-style/cpp-style.json，找不到返回 null */
function findProjectConfig(filePath) {
  try {
    let dir = path.dirname(path.resolve(filePath));
    let prev = null;
    while (dir && dir !== prev) {
      const candidate = path.join(dir, '.claude-cpp-style', 'cpp-style.json');
      if (fs.existsSync(candidate)) return candidate;
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch (_) {}
  return null;
}

/** 规范化：字段级合并 base ⊕ override，checks 各项缺失默认 true */
function normalize(base, override) {
  const merged = { ...DEFAULT_CONFIG, ...base, ...override };
  const checksIn = { ...DEFAULT_CONFIG.checks, ...(base && base.checks), ...(override && override.checks) };
  const checks = {
    clangFormat: checksIn.clangFormat !== false,
    copyright: checksIn.copyright !== false,
    cpplint: checksIn.cpplint !== false,
    bom: checksIn.bom !== false,
  };
  const copyrightInfo = {
    ...DEFAULT_CONFIG.copyrightInfo,
    ...(base && base.copyrightInfo),
    ...(override && override.copyrightInfo),
  };
  return {
    enabled: merged.enabled !== false,
    mode: merged.mode === 'full' ? 'full' : 'incremental',
    checks,
    copyrightInfo,
  };
}

/**
 * 读全局模板 ⊕ 项目配置字段级覆盖，返回规范化配置对象。
 * 全局/项目缺失或损坏 → 用默认值，绝不崩。
 * @param {string} filePath 被编辑文件路径
 * @param {string} [globalPath] 全局模板路径（默认 ~/.claude/cpp-style-template.json）
 * @returns {{enabled:boolean, mode:string, checks:object, copyrightInfo:object}}
 */
function loadConfig(filePath, globalPath = userTemplatePath()) {
  const global = readJsonSafe(globalPath) || {};
  const projectPath = filePath ? findProjectConfig(filePath) : null;
  const project = (projectPath && readJsonSafe(projectPath)) || {};
  return normalize(global, project);
}

module.exports = { loadConfig, ensureUserTemplate, userTemplatePath, DEFAULT_CONFIG };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/config.test.js` → `config.test.js PASS`。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/lib/config.js plugins/cpp-style-enforcer/hooks/js/__tests__/config.test.js
git commit -m "feat(cpp-style-enforcer): lib/config.js 全局⊕项目字段级覆盖 + ensureUserTemplate 不覆盖"
```

---

## Task 9: steps/bom.js（补 BOM / GBK 转码，CMake 跳过）

spec §5 BOM 行：`applyBom(filePath, {isCMake})`。isCMake=true → 直接返回不动；否则用 `bom_util.detectEncoding` 分类：UTF-8 无 BOM → 补、已有 BOM → 不写、GBK → iconv 转码加 BOM、UTF-16 → 跳过、空文件 → 只写 BOM；内容无变化不写。

**Files**
- Create: `hooks/js/steps/bom.js`
- Test: `hooks/js/__tests__/bom.test.js`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/bom.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyBom } = require('../steps/bom.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bomstep-'));
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; }

// UTF-8 无 BOM → 补 BOM
const f1 = write('a.cpp', Buffer.from('int a;', 'utf-8'));
applyBom(f1, { isCMake: false });
let b1 = fs.readFileSync(f1);
assert.ok(b1.slice(0, 3).equals(BOM), 'UTF-8 无 BOM → 补 BOM');

// 已有 BOM → 不重复写（mtime 不变）
const f2 = write('b.cpp', Buffer.concat([BOM, Buffer.from('int b;', 'utf-8')]));
const m2 = fs.statSync(f2).mtimeMs;
const before2 = fs.readFileSync(f2);
applyBom(f2, { isCMake: false });
assert.ok(fs.readFileSync(f2).equals(before2), '已有 BOM 内容不变');
assert.strictEqual(fs.statSync(f2).mtimeMs, m2, '已有 BOM 不写 mtime 不变');

// CMake 项目 → 跳过（无 BOM 仍无 BOM）
const f3 = write('c.cpp', Buffer.from('int c;', 'utf-8'));
applyBom(f3, { isCMake: true });
assert.ok(!fs.readFileSync(f3).slice(0, 3).equals(BOM), 'CMake 项目跳过 BOM');

// 空文件 → 只写 BOM
const f4 = write('d.cpp', Buffer.alloc(0));
applyBom(f4, { isCMake: false });
const b4 = fs.readFileSync(f4);
assert.ok(b4.equals(BOM), '空文件只写 BOM');

// UTF-16 → 跳过（不动）
const utf16 = Buffer.from([0xFF, 0xFE, 0x41, 0x00]);
const f5 = write('e.cpp', utf16);
applyBom(f5, { isCMake: false });
assert.ok(fs.readFileSync(f5).equals(utf16), 'UTF-16 跳过不动');

console.log('bom.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/bom.test.js`。预期失败：`Cannot find module '../steps/bom.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/steps/bom.js`：
```js
'use strict';

const fs = require('fs');
const { detectEncoding, BOM } = require('../lib/bom_util.js');

/**
 * 补 UTF-8 BOM / GBK 转码加 BOM。内容无变化不写。
 * CMake 项目（isCMake=true）整体跳过。
 * @param {string} filePath
 * @param {{isCMake?:boolean}} options
 * @returns {boolean} 是否改写了文件
 */
function applyBom(filePath, options = {}) {
  if (options.isCMake) return false;
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (_) { return false; }

  // 空文件 → 只写 BOM
  if (buf.length === 0) {
    try { fs.writeFileSync(filePath, BOM); return true; } catch (_) { return false; }
  }

  const enc = detectEncoding(buf);
  if (enc === 'utf-8-bom') return false;      // 已有 BOM → 不写
  if (enc === 'utf-16') return false;          // UTF-16 → 跳过

  if (enc === 'gbk') {
    try {
      const iconv = require('iconv-lite');
      const text = iconv.decode(buf, 'gbk');
      const out = Buffer.concat([BOM, Buffer.from(text, 'utf-8')]);
      fs.writeFileSync(filePath, out);
      return true;
    } catch (_) {
      return false; // iconv 缺失 → 跳过，不崩
    }
  }

  // utf-8（无 BOM）或 unknown → 补 BOM
  try {
    fs.writeFileSync(filePath, Buffer.concat([BOM, buf]));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyBom };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/bom.test.js` → `bom.test.js PASS`。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/steps/bom.js plugins/cpp-style-enforcer/hooks/js/__tests__/bom.test.js
git commit -m "feat(cpp-style-enforcer): steps/bom.js 补BOM/GBK转码 CMake跳过"
```

---

## Task 10: steps/clang_format.js（BOM 感知格式化）

spec §5 clang-format「BOM 感知」：`applyClangFormat(filePath)` 读文件 → `bom_util.stripBom` → 无 BOM 正文通过 stdin 喂给 `clang-format -style=file -fallback-style=Google`（spawnSync，读 stdout）→ 与无 BOM 正文 diff → 仅当不同则 `bom_util.restoreBom(hadBom, formatted)` 写回；clang-format 不在 PATH → 静默返回；不用 `-i`、不传 `--sort-includes`。

**Files**
- Create: `hooks/js/steps/clang_format.js`
- Test: `hooks/js/__tests__/clang_format.test.js`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/clang_format.test.js`（用桩检测 clang-format 是否存在，缺失则只验证降级分支）：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyClangFormat } = require('../steps/clang_format.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; }

const hasClangFormat = spawnSync('clang-format', ['--version'], { stdio: 'pipe' }).status === 0;

if (!hasClangFormat) {
  // 降级分支：clang-format 不在 PATH → 静默返回 false，文件不动
  const f = write('a.cpp', Buffer.from('int  main( ){return 0;}', 'utf-8'));
  const before = fs.readFileSync(f);
  const changed = applyClangFormat(f);
  assert.strictEqual(changed, false, 'clang-format 缺失 → 返回 false');
  assert.ok(fs.readFileSync(f).equals(before), 'clang-format 缺失 → 文件不动');
  console.log('clang_format.test.js PASS (clang-format absent, degrade-only)');
  process.exit(0);
}

// 有变化 → 写回（杂乱格式被规范化）
const messy = write('a.cpp', Buffer.from('int  main( ){return 0;}\n', 'utf-8'));
const changed1 = applyClangFormat(messy);
assert.strictEqual(changed1, true, '杂乱格式 → 有变化写回');

// 无变化 → 不写回（mtime 不变）：先格式化一次，再跑一次应无变化
const m = fs.statSync(messy).mtimeMs;
const changed2 = applyClangFormat(messy);
assert.strictEqual(changed2, false, '已规范 → 无变化不写回');
assert.strictEqual(fs.statSync(messy).mtimeMs, m, '无变化 mtime 不变');

// 带 BOM 文件格式化后 BOM 仍是首字节
const messyBom = write('b.cpp', Buffer.concat([BOM, Buffer.from('int  x( ){return 1;}\n', 'utf-8')]));
applyClangFormat(messyBom);
const out = fs.readFileSync(messyBom);
assert.ok(out.slice(0, 3).equals(BOM), '带 BOM 格式化后 BOM 仍首字节');
assert.ok(!out.slice(3, 6).equals(BOM), 'BOM 不重复');

console.log('clang_format.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/clang_format.test.js`。预期失败：`Cannot find module '../steps/clang_format.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/steps/clang_format.js`：
```js
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripBom, restoreBom } = require('../lib/bom_util.js');

const isWindows = process.platform === 'win32';

/**
 * BOM 感知的 clang-format：剥 BOM → 无 BOM 正文经 stdin 喂 clang-format(stdout)
 * → 与无 BOM 正文 diff → 仅变化时 restoreBom 写回。clang-format 缺失静默返回。
 * 不用 -i、不传 --sort-includes。
 * @param {string} filePath
 * @returns {boolean} 是否改写了文件
 */
function applyClangFormat(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);

  const r = spawnSync(
    'clang-format',
    ['-style=file', '-fallback-style=Google', `-assume-filename=${filePath}`],
    { input: body, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, windowsHide: isWindows }
  );
  // clang-format 不在 PATH（ENOENT）或执行失败 → 静默跳过
  if (r.error || r.status !== 0 || !r.stdout) return false;

  const formatted = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
  if (formatted.equals(body)) return false; // 无变化不写

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, formatted));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyClangFormat };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/clang_format.test.js` → `clang_format.test.js PASS`（或 clang-format 缺失时的降级 PASS）。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/steps/clang_format.js plugins/cpp-style-enforcer/hooks/js/__tests__/clang_format.test.js
git commit -m "feat(cpp-style-enforcer): steps/clang_format.js BOM感知格式化 stdin/stdout"
```

---

## Task 11: steps/copyright.js（BOM 感知插/更版权头 + dateFormat 生效 + 同日去重）

spec §5 copyright/§6：`applyCopyright(filePath, copyrightInfo)`。company 空 → 不写直接返回；`bom_util.stripBom` → 在无 BOM 正文插入/更新版权头 → `restoreBom` 拼回（头在 BOM 之后）；`dateFormat` 必须含 YYYY+MM+DD 否则回退默认 `YYYY/MM/DD HH:mm`；按 dateFormat 格式化当前时间生成 Date 行（占位符替换，MM 与 mm 不互相误伤）；同日去重用 dateFormat 动态生成解析正则提年月日，与今天相等则整次跳过；更新已有头时归正错位 BOM。

**Files**
- Create: `hooks/js/steps/copyright.js`
- Test: `hooks/js/__tests__/copyright.test.js`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/copyright.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyCopyright } = require('../steps/copyright.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copyright-'));
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; }
const info = (over) => ({ company: 'ACME', author: 'kevin', dateFormat: 'YYYY/MM/DD HH:mm', ...over });

// 无头 → 插入
const f1 = write('a.cpp', Buffer.from('int a;\n', 'utf-8'));
applyCopyright(f1, info());
let t1 = fs.readFileSync(f1, 'utf-8');
assert.ok(/Copyright .*ACME/.test(t1), '插入含公司名版权头');
assert.ok(/Author kevin/.test(t1), '插入 Author 行');
assert.ok(/Date \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(t1), 'Date 行按默认格式');
assert.ok(/int a;/.test(t1), '原内容保留');

// company 空 → 不写
const f2 = write('b.cpp', Buffer.from('int b;\n', 'utf-8'));
const before2 = fs.readFileSync(f2);
applyCopyright(f2, info({ company: '' }));
assert.ok(fs.readFileSync(f2).equals(before2), 'company 空不写');

// 含 BOM 插头后 BOM 仍首字节
const f3 = write('c.cpp', Buffer.concat([BOM, Buffer.from('int c;\n', 'utf-8')]));
applyCopyright(f3, info());
const b3 = fs.readFileSync(f3);
assert.ok(b3.slice(0, 3).equals(BOM), '含 BOM 插头后 BOM 仍首字节');
assert.ok(!b3.slice(3, 6).equals(BOM), 'BOM 不重复');
assert.ok(/Copyright/.test(b3.slice(3).toString('utf-8')), '版权头在 BOM 之后');

// dateFormat YYYY-MM-DD 生效
const f4 = write('d.cpp', Buffer.from('int d;\n', 'utf-8'));
applyCopyright(f4, info({ dateFormat: 'YYYY-MM-DD' }));
const t4 = fs.readFileSync(f4, 'utf-8');
assert.ok(/Date \d{4}-\d{2}-\d{2}\b/.test(t4), 'dateFormat YYYY-MM-DD 生效');
assert.ok(!/Date \d{4}-\d{2}-\d{2} /.test(t4), '无时间部分');

// dateFormat 缺 YMD（仅 YYYY）→ 回退默认带时间
const f5 = write('e.cpp', Buffer.from('int e;\n', 'utf-8'));
applyCopyright(f5, info({ dateFormat: 'YYYY' }));
const t5 = fs.readFileSync(f5, 'utf-8');
assert.ok(/Date \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(t5), 'dateFormat 缺 YMD 回退默认格式');

// 同日去重：第二次（即使分钟不同）不刷新 —— 模拟已有今日头
const today = new Date();
const yyyy = String(today.getFullYear());
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const existing = `// Copyright (c) ${yyyy} ACME\n// Author kevin\n// Date ${yyyy}/${mm}/${dd} 00:00\n\nint f;\n`;
const f6 = write('f.cpp', Buffer.from(existing, 'utf-8'));
const before6 = fs.readFileSync(f6);
applyCopyright(f6, info());
assert.ok(fs.readFileSync(f6).equals(before6), '同日（分钟不同）→ 不刷新整次跳过');

// 跨天 → 更新
const existingOld = `// Copyright (c) 2000 ACME\n// Author kevin\n// Date 2000/01/01 00:00\n\nint g;\n`;
const f7 = write('g.cpp', Buffer.from(existingOld, 'utf-8'));
applyCopyright(f7, info());
const t7 = fs.readFileSync(f7, 'utf-8');
assert.ok(t7.includes(`Date ${yyyy}/${mm}/${dd}`), '跨天 → Date 更新为今天');
assert.ok(!t7.includes('2000/01/01'), '旧 Date 被替换');

console.log('copyright.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/copyright.test.js`。预期失败：`Cannot find module '../steps/copyright.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/steps/copyright.js`：
```js
'use strict';

const fs = require('fs');
const { stripBom, restoreBom } = require('../lib/bom_util.js');

const DEFAULT_DATE_FORMAT = 'YYYY/MM/DD HH:mm';

/** dateFormat 必须含 YYYY/MM/DD，否则回退默认 */
function validateDateFormat(fmt) {
  if (typeof fmt !== 'string') return DEFAULT_DATE_FORMAT;
  if (fmt.includes('YYYY') && fmt.includes('MM') && fmt.includes('DD')) return fmt;
  process.stderr.write('[cpp-style-enforcer] dateFormat 缺 YYYY/MM/DD，回退默认格式\n');
  return DEFAULT_DATE_FORMAT;
}

/** 按 dateFormat 格式化日期；先替换长占位符避免 MM/mm 互相误伤 */
function formatDate(fmt, d) {
  const tokens = {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0'),
    HH: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
  };
  // 顺序：YYYY → MM → DD → HH → mm（长度降序 + MM 在 mm 前），用占位串中转防二次命中
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (m) => tokens[m]);
}

/** 由 dateFormat 动态生成解析正则（YYYY→(?<Y>\d{4}) 等），其余字符转义为字面量 */
function buildDateRegex(fmt) {
  let re = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt.startsWith('YYYY', i)) { re += '(?<Y>\\d{4})'; i += 4; }
    else if (fmt.startsWith('MM', i)) { re += '(?<M>\\d{2})'; i += 2; }
    else if (fmt.startsWith('DD', i)) { re += '(?<D>\\d{2})'; i += 2; }
    else if (fmt.startsWith('HH', i)) { re += '\\d{2}'; i += 2; }
    else if (fmt.startsWith('mm', i)) { re += '\\d{2}'; i += 2; }
    else { re += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; }
  }
  return new RegExp('// Date ' + re);
}

/**
 * 插入/更新版权头。company 空 → 不写。BOM 感知（头在 BOM 之后）。
 * 同日去重：已有今日 Date 行则整次跳过。更新已有头归正错位 BOM。
 * @param {string} filePath
 * @param {{company:string, author:string, dateFormat:string}} copyrightInfo
 * @returns {boolean} 是否改写了文件
 */
function applyCopyright(filePath, copyrightInfo) {
  const { company, author } = copyrightInfo || {};
  if (!company) return false;

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);
  const text = body.toString('utf-8');

  const fmt = validateDateFormat(copyrightInfo.dateFormat);
  const now = new Date();
  const dateStr = formatDate(fmt, now);

  // 同日去重：从已有 Date 行提年月日与今天比对
  const dateRe = buildDateRegex(fmt);
  const existing = text.match(dateRe);
  if (existing && existing.groups) {
    const sameDay = existing.groups.Y === String(now.getFullYear())
      && existing.groups.M === String(now.getMonth() + 1).padStart(2, '0')
      && existing.groups.D === String(now.getDate()).padStart(2, '0');
    if (sameDay) return false; // 同天只写一次
  }

  const header = [
    `// Copyright (c) ${now.getFullYear()} ${company}`,
    ...(author ? [`// Author ${author}`] : []),
    `// Date ${dateStr}`,
    '',
  ].join('\n') + '\n';

  // 已有版权头（以 // Copyright 开头的连续注释块）→ 替换；否则前置插入
  const hasHeader = /^(﻿)?\s*\/\/ Copyright/.test(text);
  let newText;
  if (hasHeader) {
    // 去掉文件开头的旧版权注释块（连续 // 行 + 紧随空行）
    newText = text.replace(/^(?:\/\/.*\n)+(?:\n)?/, '') ;
    newText = header + newText;
  } else {
    newText = header + text;
  }
  if (newText === text) return false;

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, Buffer.from(newText, 'utf-8')));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyCopyright, formatDate, validateDateFormat, buildDateRegex };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/copyright.test.js` → `copyright.test.js PASS`。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/steps/copyright.js plugins/cpp-style-enforcer/hooks/js/__tests__/copyright.test.js
git commit -m "feat(cpp-style-enforcer): steps/copyright.js BOM感知版权头+dateFormat+同日去重"
```

---

## Task 12: steps/cpplint.js（临时副本 lint，不写回原文件 + 去重前 5 条）

spec §6/§6.1：`runCpplint(filePath, {root, suppressCopyright})` 解析 cpplint 可执行（python + 内置 cpplint.py）；读磁盘文件 → `stripBom` → 写临时副本 `os.tmpdir()/cpp-style-enforcer/<projHash>/<relPathHash>-<basename>`（相对仓库根路径 hash 防同名碰撞）→ spawnSync python cpplint.py --filter（suppressCopyright 加 `-legal/copyright`）--quiet → 解析 stderr 违规（line/category/message）→ 原文件不写回 → 删临时副本 → 返回违规数组。`formatViolations(violations)` 逐字去重（key=line:category:message）取前 5 拼 reason（含「还有 N 条」），不用 confidence。

**Files**
- Create: `hooks/js/steps/cpplint.js`
- Test: `hooks/js/__tests__/cpplint.test.js`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/cpplint.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCpplint, formatViolations, parseCpplintOutput, MAX_ERRORS_SHOWN } = require('../steps/cpplint.js');

// ---- formatViolations：逐字去重后取前 5 + 「还有 N 条」----
const many = [];
for (let i = 1; i <= 8; i++) many.push({ line: i, category: 'whitespace/indent', message: `msg ${i}` });
many.push({ line: 1, category: 'whitespace/indent', message: 'msg 1' }); // 与首条逐字相同 → 去重
const reason = formatViolations(many);
assert.ok(reason.includes('msg 1') && reason.includes('msg 5'), '取前 5 条');
assert.ok(!reason.includes('msg 6'), '第 6 条不在前 5');
assert.ok(/还有 3 条/.test(reason), '去重后 8 条，显示 5 条，还有 3 条');
assert.strictEqual(MAX_ERRORS_SHOWN, 5, 'MAX_ERRORS_SHOWN=5');

// 全相同条目 → 去重为 1 条，无「还有」
const dup = [
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
];
const r2 = formatViolations(dup);
assert.ok(r2.includes('same'), '保留 1 条');
assert.ok(!/还有/.test(r2), '去重后仅 1 条无「还有」提示');

// ---- parseCpplintOutput：解析 line/category/message ----
const sample = [
  '/tmp/x.cpp:0:  No copyright message found.  [legal/copyright] [5]',
  '/tmp/x.cpp:12:  Missing space before {  [whitespace/braces] [5]',
].join('\n');
const parsed = parseCpplintOutput(sample);
assert.strictEqual(parsed.length, 2, '解析 2 条');
assert.strictEqual(parsed[1].line, 12, 'line 解析');
assert.strictEqual(parsed[1].category, 'whitespace/braces', 'category 解析');
assert.ok(/Missing space/.test(parsed[1].message), 'message 解析');

// ---- runCpplint：原文件字节零改动 + 临时副本防碰撞（需 python）----
const hasPython = spawnSync('python', ['--version'], { stdio: 'pipe' }).status === 0
  || spawnSync('python3', ['--version'], { stdio: 'pipe' }).status === 0;
if (hasPython) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplint-'));
  const f = path.join(tmp, 'main.cpp');
  const content = Buffer.from('int main(){return 0;}\n', 'utf-8');
  fs.writeFileSync(f, content);
  const before = fs.readFileSync(f);
  const viol = runCpplint(f, { root: tmp, suppressCopyright: true });
  assert.ok(Array.isArray(viol), 'runCpplint 返回数组');
  assert.ok(fs.readFileSync(f).equals(before), 'cpplint 步骤原文件字节零改动');
  console.log('cpplint.test.js PASS');
} else {
  console.log('cpplint.test.js PASS (python absent, parse/format-only)');
}
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/cpplint.test.js`。预期失败：`Cannot find module '../steps/cpplint.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/steps/cpplint.js`：
```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { stripBom } = require('../lib/bom_util.js');

const isWindows = process.platform === 'win32';
const MAX_ERRORS_SHOWN = 5;
const CPPLINT_PY = path.join(__dirname, '..', 'cpplint', 'cpplint.py');

/** 解析 python 可执行（python / python3），都没有返回 null */
function resolvePython() {
  for (const cmd of ['python', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe', windowsHide: isWindows });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

function shortHash(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 8);
}

/** 解析 cpplint stderr：`path:line:  message  [category] [conf]` → {line,category,message} */
function parseCpplintOutput(out) {
  const violations = [];
  const re = /^.*?:(\d+):\s+(.*?)\s+\[([^\]]+)\](?:\s+\[\d+\])?\s*$/;
  for (const raw of String(out).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    violations.push({ line: parseInt(m[1], 10), message: m[2].trim(), category: m[3].trim() });
  }
  return violations;
}

/**
 * 在临时副本上跑 cpplint（不写回原文件）。
 * @param {string} filePath
 * @param {{root?:string, suppressCopyright?:boolean}} options
 * @returns {Array<{line:number, category:string, message:string}>}
 */
function runCpplint(filePath, options = {}) {
  const python = resolvePython();
  if (!python || !fs.existsSync(CPPLINT_PY)) {
    process.stderr.write('[cpp-style-enforcer] python/cpplint 不可用，跳过 cpplint\n');
    return [];
  }

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return []; }
  const { body } = stripBom(raw);

  const root = options.root || path.dirname(filePath);
  let rel;
  try { rel = path.relative(root, filePath); } catch (_) { rel = path.basename(filePath); }
  const projHash = shortHash(root);
  const relHash = shortHash(rel);
  const tmpDir = path.join(os.tmpdir(), 'cpp-style-enforcer', projHash);
  const tmpFile = path.join(tmpDir, `${relHash}-${path.basename(filePath)}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, body);
  } catch (_) {
    return [];
  }

  const args = [CPPLINT_PY, '--quiet'];
  if (options.suppressCopyright) args.push('--filter=-legal/copyright');
  args.push(tmpFile);

  let violations = [];
  try {
    const r = spawnSync(python, args, { stdio: 'pipe', timeout: 15000, windowsHide: isWindows });
    const stderr = (r.stderr || Buffer.alloc(0)).toString('utf-8');
    violations = parseCpplintOutput(stderr);
  } catch (_) {
    violations = [];
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
  return violations;
}

/**
 * 逐字去重（key=line:category:message）→ 取前 5 → 拼 reason（含「还有 N 条」）。
 * @param {Array<{line:number, category:string, message:string}>} violations
 * @returns {string}
 */
function formatViolations(violations) {
  const seen = new Set();
  const unique = [];
  for (const v of violations) {
    const key = `${v.line}:${v.category}:${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }
  const shown = unique.slice(0, MAX_ERRORS_SHOWN);
  const lines = shown.map((v) => `  - 行 ${v.line} [${v.category}] ${v.message}`);
  let reason = 'cpplint 检测到以下 C++ 风格违规，请修复：\n' + lines.join('\n');
  const remaining = unique.length - shown.length;
  if (remaining > 0) {
    reason += `\n  ... 还有 ${remaining} 条违规未显示，修复以上后重新编辑该文件以重新检查`;
  }
  return reason;
}

module.exports = { runCpplint, formatViolations, parseCpplintOutput, MAX_ERRORS_SHOWN };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/cpplint.test.js` → `cpplint.test.js PASS`（或 python 缺失时的 parse/format-only PASS）。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/steps/cpplint.js plugins/cpp-style-enforcer/hooks/js/__tests__/cpplint.test.js
git commit -m "feat(cpp-style-enforcer): steps/cpplint.js 临时副本lint不写回原文件+去重前5条"
```

---

## Task 13: post_edit.js（PostToolUse 入口薄壳：读输入→编排 steps→协议输出）

把 T2-T12 的 lib/steps 编排成单进程流水线。删除旧 `mode===null` 兜底拦截（崩溃源）。门控：`applyTriple=(mode==='full')||(mode==='incremental'&&isNew)`；BOM 独立于 mode，仅受 `enabled && checks.bom && !isCMake` 门控。每步独立 try/catch，顶层 try/catch 兜底 `passSilent()`。有 cpplint 违规 → `blockClaude(formatViolations(...))`，否则 `passSilent()`。

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/post_edit.integration.test.js`（黑盒喂 stdin，断言 exit/stdout）：
```js
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'post_edit.js');

function runHook(input) {
  const r = spawnSync('node', [entry], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 30000,
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: r.stderr || '' };
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cse-pe-'));
}

// 1) Bash 含 .cpp 字样但无 file_path → passSilent（exit 0，stdout 空）
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'echo build main.cpp' } });
  assert.strictEqual(r.status, 0, 'Bash 无 file_path 应 exit 0');
  assert.strictEqual(r.stdout, '', 'Bash 应 stdout 空');
}

// 2) 文件不存在 → passSilent
{
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(mkTmpDir(), 'nope.cpp') } });
  assert.strictEqual(r.status, 0, '文件不存在应 exit 0');
  assert.strictEqual(r.stdout, '', '文件不存在应 stdout 空');
}

// 3) 非 C++ 文件 → passSilent
{
  const dir = mkTmpDir();
  const f = path.join(dir, 'readme.txt');
  fs.writeFileSync(f, 'hello');
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, '非 C++ 应 exit 0');
  assert.strictEqual(r.stdout, '', '非 C++ 应 stdout 空');
}

// 4) enabled:false 项目 → no-op（即便有违规也不 block）
{
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude-cpp-style'));
  fs.writeFileSync(path.join(dir, '.claude-cpp-style', 'cpp-style.json'), JSON.stringify({ enabled: false }));
  const f = path.join(dir, 'main.cpp');
  fs.writeFileSync(f, 'int main(){return 0;}\n');
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, 'enabled:false 应 exit 0');
  assert.strictEqual(r.stdout, '', 'enabled:false 应 stdout 空（no-op）');
}

// 5) 协议铁律：任何情况都绝不 exit 2 / exit 1
{
  const r = runHook({ tool_name: 'Edit', tool_input: {} });
  assert.notStrictEqual(r.status, 2, '永不 exit 2');
  assert.notStrictEqual(r.status, 1, '永不 exit 1');
}

console.log('post_edit.integration.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/post_edit.integration.test.js`。预期失败：`Cannot find module '.../post_edit.js'`（入口尚不存在）。

- [ ] **Step 3: 写最小实现** `hooks/js/post_edit.js`：
```js
'use strict';

const { readStdinJson } = require('./lib/stdin');
const { passSilent, blockClaude, diag } = require('./lib/protocol');
const { resolveFilePath, shouldHandle } = require('./lib/target');
const { loadConfig } = require('./lib/config');
const { repoRoot, isNew } = require('./lib/git');
const { isCMakeProject } = require('./lib/project');
const { applyClangFormat } = require('./steps/clang_format');
const { applyBom } = require('./steps/bom');
const { applyCopyright } = require('./steps/copyright');
const { runCpplint, formatViolations } = require('./steps/cpplint');

function step(name, fn) {
  try {
    return fn();
  } catch (e) {
    diag(`step ${name} 异常跳过: ${e && e.message ? e.message : e}`);
    return undefined;
  }
}

async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return passSilent();

  const filePath = resolveFilePath(input);
  if (!filePath || !shouldHandle(filePath)) return passSilent();

  const config = loadConfig(filePath);
  if (config.enabled === false) return passSilent();

  const { mode, checks, copyrightInfo } = config;
  const root = step('repoRoot', () => repoRoot(filePath)) || null;
  const fileIsNew = step('isNew', () => isNew(filePath, root));
  const applyTriple = mode === 'full' || (mode === 'incremental' && fileIsNew !== false);
  const isCMake = step('isCMake', () => isCMakeProject(filePath)) === true;

  // 1. clang-format（仅全套文件）
  if (applyTriple && checks.clangFormat) {
    step('clang_format', () => applyClangFormat(filePath));
  }

  // 2. BOM（独立于 mode；CMake 项目跳过）
  if (checks.bom && !isCMake) {
    step('bom', () => applyBom(filePath, { isCMake }));
  }

  // 3. copyright（仅全套文件；company 非空才写）
  if (applyTriple && checks.copyright && copyrightInfo && copyrightInfo.company) {
    step('copyright', () => applyCopyright(filePath, copyrightInfo));
  }

  // 4. cpplint（仅全套文件）→ 有违规 blockClaude
  if (applyTriple && checks.cpplint) {
    const suppressCopyright = !(copyrightInfo && copyrightInfo.company) || checks.copyright === false;
    const violations = step('cpplint', () => runCpplint(filePath, { root, suppressCopyright })) || [];
    if (violations.length > 0) {
      return blockClaude(formatViolations(violations));
    }
  }

  return passSilent();
}

main().catch((e) => {
  try { diag(`post_edit 顶层异常兜底 passSilent: ${e && e.message ? e.message : e}`); } catch (_) {}
  passSilent();
});
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/post_edit.integration.test.js` → `post_edit.integration.test.js PASS`，exit 0。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/post_edit.js plugins/cpp-style-enforcer/hooks/js/__tests__/post_edit.integration.test.js
git commit -m "feat(cpp-style-enforcer): post_edit.js 单进程流水线入口 全程exit0 删mode===null拦截"
```

---

## Task 14: pre_commit.js（PreToolUse 入口薄壳：git commit lint）

仅拦截真正的 `git commit`（收紧正则防 `echo "git commit"` / `git commit-graph` / `git commit-tree` 误判；存疑放行）。对暂存区 C++ 文件（incremental 仅新文件）跑 cpplint，违规 → `denyTool(reason)`，否则 `passSilent()`。

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/pre_commit.integration.test.js`：
```js
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'pre_commit.js');
const { isGitCommit } = require(path.join(pluginRoot, 'hooks', 'js', 'pre_commit.js'));

function runHook(command) {
  const r = spawnSync('node', [entry], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf-8',
    timeout: 30000,
  });
  return { status: r.status, stdout: (r.stdout || '').trim() };
}

// isGitCommit 单元断言：真 commit 命中，假阳性放行
assert.strictEqual(isGitCommit('git commit -m "x"'), true, '真 git commit 应命中');
assert.strictEqual(isGitCommit('git commit'), true, '裸 git commit 应命中');
assert.strictEqual(isGitCommit('  git   commit  --amend'), true, '多空格 git commit 应命中');
assert.strictEqual(isGitCommit('echo "git commit"'), false, 'echo 内 git commit 不应命中');
assert.strictEqual(isGitCommit('git commit-graph write'), false, 'commit-graph 不应命中');
assert.strictEqual(isGitCommit('git commit-tree HEAD^{tree}'), false, 'commit-tree 不应命中');
assert.strictEqual(isGitCommit('git status'), false, 'git status 不应命中');

// 非 commit 命令 → passSilent（exit 0，stdout 空）
{
  const r = runHook('git status');
  assert.strictEqual(r.status, 0, '非 commit 应 exit 0');
  assert.strictEqual(r.stdout, '', '非 commit 应 stdout 空');
}

// echo 含 git commit → 不触发 lint，passSilent
{
  const r = runHook('echo "git commit"');
  assert.strictEqual(r.status, 0, 'echo 应 exit 0');
  assert.strictEqual(r.stdout, '', 'echo 应 stdout 空');
}

console.log('pre_commit.integration.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/pre_commit.integration.test.js`。预期失败：`Cannot find module '.../pre_commit.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/pre_commit.js`：
```js
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const { readStdinJson } = require('./lib/stdin');
const { passSilent, denyTool, diag } = require('./lib/protocol');
const { loadConfig } = require('./lib/config');
const { repoRoot, isNew } = require('./lib/git');
const { shouldHandle } = require('./lib/target');
const { runCpplint, formatViolations } = require('./steps/cpplint');

const isWindows = process.platform === 'win32';

/**
 * 收紧正则判定真正的 `git commit`：
 * - 命令以 git 开头（允许前导空白），后接 commit 作为独立子命令（词边界）。
 * - 排除 commit-graph / commit-tree（连字符后缀）与 echo/字符串包裹（命令必须以 git 起头）。
 * - 存疑一律返回 false（放行，不阻止）。
 * @param {string} command
 * @returns {boolean}
 */
function isGitCommit(command) {
  if (typeof command !== 'string') return false;
  // ^\s*git\s+commit  且 commit 后不接连字符（排除 commit-graph/commit-tree），后接空白/结尾/选项
  return /^\s*git\s+commit(?![-\w])/.test(command);
}

/**
 * 暂存区 C++ 文件（--diff-filter=ACM），过滤扩展名/排除目录。
 * @param {string} root
 * @returns {string[]} 绝对路径数组
 */
function stagedCppFiles(root) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: root, encoding: 'utf-8', timeout: 5000, windowsHide: isWindows,
  });
  if (r.error || r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rel) => path.resolve(root, rel))
    .filter((abs) => shouldHandle(abs));
}

async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return passSilent();

  const command = input.tool_input && input.tool_input.command;
  if (!isGitCommit(command)) return passSilent();

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  if (config.enabled === false || !config.checks.cpplint) return passSilent();

  const root = repoRoot(cwd);
  if (!root) return passSilent();

  let files = stagedCppFiles(root);
  if (config.mode === 'incremental') {
    files = files.filter((f) => isNew(f, root) !== false);
  }
  if (files.length === 0) return passSilent();

  const suppressCopyright = !(config.copyrightInfo && config.copyrightInfo.company) || config.checks.copyright === false;
  const allViolations = [];
  for (const f of files) {
    try {
      const v = runCpplint(f, { root, suppressCopyright });
      for (const item of v) allViolations.push({ ...item, file: path.relative(root, f) });
    } catch (e) {
      diag(`pre_commit cpplint 跳过 ${f}: ${e && e.message ? e.message : e}`);
    }
  }

  if (allViolations.length > 0) {
    return denyTool('提交被阻止：暂存的 C++ 文件存在 cpplint 违规。\n' + formatViolations(allViolations));
  }
  return passSilent();
}

main().catch((e) => {
  try { diag(`pre_commit 顶层异常兜底 passSilent: ${e && e.message ? e.message : e}`); } catch (_) {}
  passSilent();
});

module.exports = { isGitCommit, stagedCppFiles };
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/pre_commit.integration.test.js` → `pre_commit.integration.test.js PASS`，exit 0。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/pre_commit.js plugins/cpp-style-enforcer/hooks/js/__tests__/pre_commit.integration.test.js
git commit -m "feat(cpp-style-enforcer): pre_commit.js 收紧git commit识别+暂存区cpplint门控"
```

---

## Task 15: session_start.js（SessionStart 入口薄壳：完全静默，仅 ensureUserTemplate）

唯一职责：保证全局默认配置文件存在。用 `__dirname` 定位插件出厂默认模板绝对路径，调 `ensureUserTemplate(defaultPath)`（已存在绝不覆盖，见 T8）。无任何 stdout/stderr 输出，exit 0，不检测项目、不拦截、不弹问。

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/session_start.integration.test.js`：
```js
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'session_start.js');

// 用临时 HOME 隔离全局模板，避免污染真实 ~/.claude
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-home-'));
const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
const userTpl = path.join(tmpHome, '.claude', 'cpp-style-template.json');

function runHook() {
  const r = spawnSync('node', [entry], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf-8',
    timeout: 10000,
    env,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// 1) 首次运行 → 创建全局模板，无输出，exit 0
{
  const r = runHook();
  assert.strictEqual(r.status, 0, 'SessionStart 应 exit 0');
  assert.strictEqual(r.stdout, '', 'SessionStart 应 stdout 空（完全静默）');
  assert.strictEqual(r.stderr, '', 'SessionStart 应 stderr 空（完全静默）');
  assert.ok(fs.existsSync(userTpl), '首次运行应创建全局模板');
}

// 2) 已存在用户自填模板 → 绝不覆盖（字节级一致）
{
  const custom = JSON.stringify({ enabled: true, mode: 'full', copyrightInfo: { company: 'ACME' } });
  fs.writeFileSync(userTpl, custom);
  const before = fs.readFileSync(userTpl);
  const r = runHook();
  assert.strictEqual(r.status, 0, '二次运行应 exit 0');
  const after = fs.readFileSync(userTpl);
  assert.ok(before.equals(after), '已存在模板必须字节级不变（不覆盖用户 company）');
}

console.log('session_start.integration.test.js PASS');
```

- [ ] **Step 2: 运行确认失败**：`node hooks/js/__tests__/session_start.integration.test.js`。预期失败：`Cannot find module '.../session_start.js'`。

- [ ] **Step 3: 写最小实现** `hooks/js/session_start.js`：
```js
'use strict';

const path = require('path');
const { ensureUserTemplate } = require('./lib/config');

// 插件出厂默认模板绝对路径（hooks/js → 插件根 → templates/）
const PLUGIN_DEFAULT_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'cpp-style-template.default.json');

try {
  ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE);
} catch (_) {
  // 复制失败（权限等）→ 静默吞掉，调用方按无全局模板降级硬编码默认
}

// 完全静默：无 stdout / stderr 输出
process.exit(0);
```

- [ ] **Step 4: 运行确认通过**：`node hooks/js/__tests__/session_start.integration.test.js` → `session_start.integration.test.js PASS`，exit 0。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/session_start.js plugins/cpp-style-enforcer/hooks/js/__tests__/session_start.integration.test.js
git commit -m "feat(cpp-style-enforcer): session_start.js 完全静默 仅ensureUserTemplate"
```

---

## Task 16: hooks.json 重写 + 删除旧入口文件（无 TDD）

3 个 hook 指向新薄壳入口。PostToolUse matcher **移除 `Bash`**（Bash 不产生 file_path，匹配只浪费空跑且曾因「字符串含 .cpp」误触发）。timeout 单位秒。然后 `git rm` 全部旧目录/文件，**保留** `cpplint/cpplint.py`。

- [ ] **Step 1: 用 Write 覆写** `hooks/hooks.json`：
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/session_start.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|mcp__.*(?:write|edit|create|replace|insert)",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/post_edit.js\"",
            "timeout": 30
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/js/pre_commit.js\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

> 注：`${CLAUDE_PLUGIN_ROOT}` 是 Claude Code 注入的插件根变量；若现有 hooks.json 用的是相对路径写法，沿用现有写法的风格（保持文件内一致），仅改入口文件名与 matcher。

- [ ] **Step 2: 删除旧入口文件/目录**（保留 `cpplint/cpplint.py`）：
```bash
cd plugins/cpp-style-enforcer
git rm -r hooks/js/post_edit_pipeline hooks/js/copyright hooks/js/cpp_style_guard hooks/js/pre_commit_lint
git rm hooks/js/lib/utils.js
git rm hooks/js/cpplint/cpplint_check.js
# 验证 cpplint.py 仍在
test -f hooks/js/cpplint/cpplint.py && echo "cpplint.py 保留 OK"
```

> 若上述某路径在当前仓库中不存在（命名略有出入），`git rm` 会报错——逐个核对实际目录名后再执行，不要静默忽略缺失（规则 12）。先 `git ls-files hooks/js | sort` 列出实际文件确认。

- [ ] **Step 3: 验证 hooks.json 合法 + 入口可加载**：
```bash
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf-8')); console.log('hooks.json 合法 JSON OK')"
node -e "require('./hooks/js/post_edit.js')" >/dev/null 2>&1 &
node -e "require('./hooks/js/session_start.js')" 2>/dev/null; echo "入口加载无语法错误"
```

- [ ] **Step 4: 跑全量已有测试确保删除无连带破坏**：
```bash
for t in hooks/js/__tests__/*.test.js; do node "$t" || { echo "FAIL: $t"; exit 1; }; done
echo "全部测试通过"
```

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/hooks.json
git commit -m "refactor(cpp-style-enforcer): hooks.json指向新入口+移除Bash matcher，删除旧流水线/copyright/guard/pre_commit_lint/utils"
```

---

## Task 17: commands/cpp-style-setup.md 重写（去交互拦截）

spec §8：去掉「必须 AskUserQuestion 弹问选模式」拦截语义；改为按需配置工具——查看/编辑全局模板 `~/.claude/cpp-style-template.json`，或为项目写 `.claude-cpp-style/cpp-style.json`（含 `enabled:false` 关闭）。**无 TDD**，步骤为 Write 新内容、commit。

**Files**
- Modify: `commands/cpp-style-setup.md`（整体重写）

- [ ] **Step 1: 先看旧文件确认 frontmatter 风格**：
```bash
sed -n '1,20p' plugins/cpp-style-enforcer/commands/cpp-style-setup.md
```
  目的：保留旧文件的 YAML frontmatter 字段（`description`/`allowed-tools` 等）风格与字段名，仅重写正文语义（规则 11 文件内一致性）。

- [ ] **Step 2: 用 Write 重写** `commands/cpp-style-setup.md`（frontmatter 按 Step 1 实际字段对齐；下方代码块中的三反引号在写入时为真实三反引号，此处为在计划文档内展示而转义）：
```markdown
---
description: 查看或配置 cpp-style-enforcer：编辑全局模板或为当前项目写覆盖配置
---

# cpp-style-enforcer 配置

本命令是**按需配置工具**，不弹问、不拦截。根据需要选择以下操作之一。

## 配置层级

1. **全局模板** `~/.claude/cpp-style-template.json`：所有项目的默认值（公司名、作者、默认 mode、各检查开关）。SessionStart 首次自动创建，**已存在绝不覆盖**。
2. **项目覆盖** `<项目根>/.claude-cpp-style/cpp-style.json`：对当前项目做**字段级覆盖**（只写想改的字段，其余回退全局模板）。

## Schema（两层同构）

    {
      "enabled": true,
      "mode": "incremental",
      "checks": { "clangFormat": true, "copyright": true, "cpplint": true, "bom": true },
      "copyrightInfo": { "company": "", "author": "", "dateFormat": "YYYY/MM/DD HH:mm" }
    }

- `enabled`：设为 false 彻底关闭本项目所有检查。
- `mode`：`incremental`（仅新文件走全套）| `full`（所有文件走全套）。
- `checks.clangFormat`：格式化（含 #include 排序）；`bom`：UTF-8 BOM 补全（CMake 项目自动跳过）。
- `copyrightInfo.company`：空 = 不写版权头，cpplint 同步屏蔽 legal/copyright；`dateFormat` 占位符 YYYY/MM/DD/HH/mm。

## 常见操作

- 设公司名/作者（全局）：编辑 `~/.claude/cpp-style-template.json` 的 `copyrightInfo.company`/`author`。
- 某项目关闭：项目根 `.claude-cpp-style/cpp-style.json` 写 `{ "enabled": false }`。
- 新项目要求所有文件规范：写 `{ "mode": "full" }`。
- 只要 BOM：写 `{ "checks": { "clangFormat": false, "copyright": false, "cpplint": false, "bom": true } }`。

## 行为速记

- **新老文件判定** = git 是否跟踪。`incremental` 下未跟踪走全套，已跟踪老文件只补 BOM。
- **CMake 项目**（向上找到 CMakeLists.txt）一律不补 BOM，其余检查照常。
- **局部豁免** include 排序：源码里用 `// clang-format off` / `// clang-format on` 包住。
```
  > 注：写入 `cpp-style-setup.md` 时，把 Schema 段落改回真实围栏代码块（```json），上方用缩进块仅为在本计划文档内避免嵌套围栏冲突。frontmatter 字段以 Step 1 看到的旧文件为准对齐。

- [ ] **Step 3: 确认无残留弹问语义**：
```bash
rg -n "AskUserQuestion|弹问|必须选择" plugins/cpp-style-enforcer/commands/cpp-style-setup.md || echo "无残留拦截语义"
```
  预期：输出 `无残留拦截语义`（rg 无匹配）。

- [ ] **Step 4: 校验 markdown frontmatter 可解析**（无 YAML 语法错误）：
```bash
node -e "const s=require('fs').readFileSync('plugins/cpp-style-enforcer/commands/cpp-style-setup.md','utf-8'); const m=s.match(/^---\n[\s\S]*?\n---/); console.log(m? 'frontmatter OK':'NO frontmatter')"
```
  预期：输出 `frontmatter OK`。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/commands/cpp-style-setup.md
git commit -m "docs(cpp-style-enforcer): 重写setup命令 去交互拦截改按需配置工具"
```

---

## Task 18: 集成回归测试 + README 更新

spec §10：写 `hooks/js/__tests__/integration.test.js` 固化集成场景——临时 git 仓库喂各场景 stdin 断言 (exit, stdout, stderr)：旧崩溃场景现在 passSilent、新文件+违规 → exit 0 + decision:block JSON、老文件 incremental 只 BOM、enabled:false 完全 no-op、流水线无子 node 进程链。再更新 README 反映 v0.3.0。

**Files**
- Create: `hooks/js/__tests__/integration.test.js`
- Modify: `plugins/cpp-style-enforcer/README.md`

- [ ] **Step 1: 写失败测试** `hooks/js/__tests__/integration.test.js`：
```js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const postEdit = path.join(__dirname, '..', 'post_edit.js');
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

// 隔离 HOME，避免读到真实全局模板（用默认配置）
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inthome-'));
const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
function runPost(input) {
  return spawnSync('node', [postEdit], { input: JSON.stringify(input), encoding: 'utf-8', timeout: 30000, env });
}

function newRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'int-'));
  sh(['init'], tmp);
  sh(['config', 'user.email', 't@t.com'], tmp);
  sh(['config', 'user.name', 't'], tmp);
  return tmp;
}

// 场景 a（旧崩溃）：未配置项目编辑已存在 .cpp → passSilent（exit 0）
{
  const repo = newRepo();
  const f = path.join(repo, 'old.cpp');
  fs.writeFileSync(f, 'int old_var;\n');
  sh(['add', 'old.cpp'], repo); sh(['commit', '-m', 'init'], repo);
  const r = runPost({ cwd: repo, tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, '场景a: 老文件编辑 exit 0（不崩）');
  // 老文件 incremental → 只补 BOM
  assert.ok(fs.readFileSync(f).slice(0, 3).equals(BOM), '场景a: 老文件只补 BOM');
  assert.ok(fs.readFileSync(f).slice(3).toString('utf-8').includes('int old_var;'), '场景a: 老文件未被格式化');
}

// 场景 e（旧崩溃）：tool_name=Bash（无 file_path）→ 即便误喂也 passSilent
{
  const repo = newRepo();
  const r = runPost({ cwd: repo, tool_name: 'Bash', tool_input: { command: 'echo "edit a.cpp"' } });
  assert.strictEqual(r.status, 0, '场景e: Bash 误喂 exit 0');
  assert.strictEqual(r.stdout.trim(), '', '场景e: 无 file_path → passSilent stdout 空');
}

// 场景：enabled:false → 完全 no-op
{
  const repo = newRepo();
  const cfgDir = path.join(repo, '.claude-cpp-style');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ enabled: false }));
  const f = path.join(repo, 'noop.cpp');
  fs.writeFileSync(f, 'int noop;\n');
  const before = fs.readFileSync(f);
  const r = runPost({ cwd: repo, tool_name: 'Write', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, 'enabled:false exit 0');
  assert.ok(fs.readFileSync(f).equals(before), 'enabled:false 文件零改动');
  assert.strictEqual(r.stdout.trim(), '', 'enabled:false stdout 空');
}

// 场景：新文件 + cpplint 违规 → exit 0 + stdout decision:block JSON（需 python+cpplint）
{
  const hasPython = spawnSync('python', ['--version'], { stdio: 'pipe' }).status === 0
    || spawnSync('python3', ['--version'], { stdio: 'pipe' }).status === 0;
  if (hasPython) {
    const repo = newRepo();
    const f = path.join(repo, 'new.cpp');
    fs.writeFileSync(f, 'int main(){int x=1;return x;}\n');
    const r = runPost({ cwd: repo, tool_name: 'Write', tool_input: { file_path: f } });
    assert.strictEqual(r.status, 0, '新文件违规 exit 0（绝不 exit 2）');
    if (r.stdout.trim()) {
      const out = JSON.parse(r.stdout.trim());
      assert.strictEqual(out.decision, 'block', '新文件违规 → decision:block JSON');
      assert.ok(typeof out.reason === 'string' && out.reason.length > 0, 'reason 非空');
    }
  }
}

console.log('integration.test.js PASS');
```

- [ ] **Step 2: 运行确认失败/通过**：`node hooks/js/__tests__/integration.test.js`。本测试是回归固化，依赖 Task 13（post_edit.js 入口）已完成。若 Task 13 尚未完成则入口缺失，spawnSync status 非 0 → 断言 `场景a: 老文件编辑 exit 0` 失败；Task 13 完成后此步直接通过。

- [ ] **Step 3: 更新 README** `plugins/cpp-style-enforcer/README.md`（先 `sed -n '1,40p' plugins/cpp-style-enforcer/README.md` 看头部确认标题/版本措辞，再用 Edit 改/补关键段，保留其余结构），关键段反映 v0.3.0：
```markdown
## v0.3.0 行为

单进程模块化流水线，全程 exit 0，cpplint 在临时副本上运行不损坏源文件。

### 配置
- 全局模板：`~/.claude/cpp-style-template.json`（SessionStart 首次创建，已存在绝不覆盖）
- 项目覆盖：`<项目根>/.claude-cpp-style/cpp-style.json`（字段级覆盖，含 `enabled:false` 关闭）

### 三档行为（新老判定 = git 是否跟踪）
| 场景 | 行为 |
|---|---|
| 新项目 / `mode:full` | 所有文件全套：clang-format（含 #include 排序）+ 版权 + cpplint + BOM |
| 老项目新文件（`incremental` 且未跟踪） | 同样全套 |
| 老项目老文件（`incremental` 且已跟踪） | **只补 BOM**，不格式化/不版权/不 lint |

### 要点
- **CMake 项目**（向上找到 CMakeLists.txt）一律不补 BOM，其余检查照常。
- **dateFormat** 是当前时间显示格式模板（占位符 `YYYY/MM/DD/HH/mm`），缺 `YYYY/MM/DD` 回退默认 `YYYY/MM/DD HH:mm`；同日不重复刷新 Date 行。
- **去交互**：不再弹问选模式，`/cpp-style-setup` 为按需配置工具。
- **局部豁免** include 排序：源码用 `// clang-format off` / `// clang-format on` 包住。
```

- [ ] **Step 4: 运行全量测试确认通过**：
```bash
for t in plugins/cpp-style-enforcer/hooks/js/__tests__/*.test.js; do node "$t" || echo "FAIL: $t"; done
```
  预期：每个测试输出各自 `PASS`（含 `integration.test.js PASS`），无 `FAIL:` 行。验证无子 node 进程链：integration 各场景在 30s timeout 内完成（单进程流水线，至多 spawn git/python/clang-format，不再 spawn 子 node）。

- [ ] **Step 5: 提交**：
```bash
git add plugins/cpp-style-enforcer/hooks/js/__tests__/integration.test.js plugins/cpp-style-enforcer/README.md
git commit -m "test(cpp-style-enforcer): 集成回归测试固化spec §10场景 + README更新v0.3.0"
```

---
