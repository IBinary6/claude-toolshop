const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'post_edit.js');
const stopEntry = path.join(pluginRoot, 'hooks', 'js', 'stop_check.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-pe-data-'));
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
let hookCounter = 0;

// 每个场景独立 session，避免前一场景记录的文件被后一场景的 Stop 消费。
function runHook(input) {
  hookCounter += 1;
  const payload = {
    session_id: `post-edit-test-${hookCounter}`,
    tool_use_id: `tool-${hookCounter}`,
    ...input,
  };
  const r = spawnSync('node', [entry], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: r.stderr || '', payload };
}

function runStop(payload, extra = {}) {
  const r = spawnSync('node', [stopEntry], {
    cwd: payload.cwd || process.cwd(),
    input: JSON.stringify({
      session_id: payload.session_id,
      cwd: payload.cwd || process.cwd(),
      hook_event_name: 'Stop',
      stop_hook_active: false,
      ...extra,
    }),
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: r.stderr || '' };
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cse-pe-'));
}

/** 只开 BOM 的项目：结果确定，不依赖本机 clang-format / Python。 */
function bomOnlyProject() {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude-cpp-style'));
  fs.writeFileSync(path.join(dir, '.claude-cpp-style', 'cpp-style.json'), JSON.stringify({
    checks: { clangFormat: false, copyright: false, cpplint: false, bom: true },
  }));
  return dir;
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

// 4) enabled:false 项目 → 编辑与收尾都 no-op（即便有违规也不 block）
{
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude-cpp-style'));
  fs.writeFileSync(path.join(dir, '.claude-cpp-style', 'cpp-style.json'), JSON.stringify({ enabled: false }));
  const f = path.join(dir, 'main.cpp');
  fs.writeFileSync(f, 'int main(){return 0;}');
  const before = fs.readFileSync(f);
  const r = runHook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, 'enabled:false 应 exit 0');
  assert.strictEqual(r.stdout, '', 'enabled:false 应 stdout 空（no-op）');
  const stop = runStop(r.payload);
  assert.strictEqual(stop.stdout, '', 'enabled:false 收尾不 block');
  assert.ok(fs.readFileSync(f).equals(before), 'enabled:false 文件零改动（BOM、末尾换行都不补）');
}

// 5) 协议铁律：任何情况都绝不 exit 2 / exit 1
{
  const r = runHook({ tool_name: 'Edit', tool_input: {} });
  assert.notStrictEqual(r.status, 2, '永不 exit 2');
  assert.notStrictEqual(r.status, 1, '永不 exit 1');
}

// 6) 编辑阶段不改写文件：改写会让 Claude 后续 Edit 因“文件已修改”失败
{
  const dir = bomOnlyProject();
  const f = path.join(dir, 'main.cpp');
  fs.writeFileSync(f, 'int main() { return 0; }\n');
  const before = fs.readFileSync(f);
  const r = runHook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.stdout, '', 'PostToolUse 只记录，不注入输出');
  assert.ok(fs.readFileSync(f).equals(before), 'PostToolUse 不立即改写文件');
  const stop = runStop(r.payload);
  assert.ok(fs.readFileSync(f).subarray(0, 3).equals(BOM), 'Stop 统一补 BOM');
  assert.strictEqual(JSON.parse(stop.stdout).decision, 'block', '改写后要求 Claude 复查最终 diff');
}

// 7) 失败的工具结果不排入自动修复
{
  const dir = bomOnlyProject();
  const file = path.join(dir, 'failed.cpp');
  fs.writeFileSync(file, 'int  value;\n');
  const before = fs.readFileSync(file);
  const failed = runHook({ cwd: dir, tool_name: 'mcp__fs__edit_file',
    tool_input: { path: file }, tool_response: { isError: true } });
  assert.strictEqual(failed.status, 0);
  assert.strictEqual(runStop(failed.payload).stdout, '', '失败的编辑不能排入后续自动修复');
  assert.ok(fs.readFileSync(file).equals(before));
}

// 8) MCP 补丁一次触碰多个文件，Stop 时全部处理
{
  const dir = bomOnlyProject();
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(test)\n');
  const a = path.join(dir, 'a.cpp');
  const b = path.join(dir, 'b.hpp');
  fs.writeFileSync(a, 'int a;\n');
  fs.writeFileSync(b, '#pragma once\n');
  const r = runHook({
    cwd: dir,
    tool_name: 'mcp__patcher__apply_patch',
    tool_input: {
      patch: ['*** Begin Patch', '*** Update File: a.cpp', '*** Update File: b.hpp', '*** End Patch'].join('\n'),
    },
  });
  assert.strictEqual(r.status, 0, '补丁后处理应 exit 0');
  assert.ok(!fs.readFileSync(a).subarray(0, 3).equals(BOM), 'PostToolUse 不立即补 BOM');
  const stop = runStop(r.payload);
  assert.strictEqual(stop.status, 0, 'Stop 统一处理应 exit 0');
  assert.ok(fs.readFileSync(a).subarray(0, 3).equals(BOM), 'a.cpp 补 BOM');
  assert.ok(fs.readFileSync(b).subarray(0, 3).equals(BOM), '多文件补丁 b.hpp 补 BOM');
}

// 9) 子代理的编辑归它自己的 SubagentStop 收尾，主 Agent 的 Stop 不越权处理
{
  const dir = bomOnlyProject();
  const f = path.join(dir, 'worker.cpp');
  fs.writeFileSync(f, 'int w;\n');
  const r = runHook({ cwd: dir, agent_id: 'agent-1', tool_name: 'Write', tool_input: { file_path: f } });
  const mainStop = runStop(r.payload);
  assert.strictEqual(mainStop.stdout, '', '主 Agent Stop 不消费子代理桶');
  assert.ok(!fs.readFileSync(f).subarray(0, 3).equals(BOM), '主 Stop 后子代理文件仍未处理');
  const subStop = runStop(r.payload, { hook_event_name: 'SubagentStop', agent_id: 'agent-1' });
  assert.strictEqual(JSON.parse(subStop.stdout).decision, 'block', 'SubagentStop 让子代理自己复查');
  assert.ok(fs.readFileSync(f).subarray(0, 3).equals(BOM), 'SubagentStop 补 BOM');
}

console.log('post_edit.integration.test.js PASS');
