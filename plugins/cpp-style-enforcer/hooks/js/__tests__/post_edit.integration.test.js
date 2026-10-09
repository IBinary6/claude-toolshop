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

// Each scenario gets its own session so files recorded by one scenario are not consumed by the next scenario's Stop.
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

/** A project with only the BOM check on: deterministic, independent of the local clang-format / Python. */
function bomOnlyProject() {
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude-cpp-style'));
  fs.writeFileSync(path.join(dir, '.claude-cpp-style', 'cpp-style.json'), JSON.stringify({
    checks: { clangFormat: false, cpplint: false, bom: true },
  }));
  return dir;
}

// 1) Bash mentioning .cpp but with no file_path -> passSilent (exit 0, empty stdout)
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'echo build main.cpp' } });
  assert.strictEqual(r.status, 0, 'Bash without file_path should exit 0');
  assert.strictEqual(r.stdout, '', 'Bash should leave stdout empty');
}

// 2) The file does not exist -> passSilent
{
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(mkTmpDir(), 'nope.cpp') } });
  assert.strictEqual(r.status, 0, 'a missing file should exit 0');
  assert.strictEqual(r.stdout, '', 'a missing file should leave stdout empty');
}

// 3) A non-C++ file -> passSilent
{
  const dir = mkTmpDir();
  const f = path.join(dir, 'readme.txt');
  fs.writeFileSync(f, 'hello');
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, 'a non-C++ file should exit 0');
  assert.strictEqual(r.stdout, '', 'a non-C++ file should leave stdout empty');
}

// 4) An enabled:false project -> both the edit and the closing step are no-ops (even with violations nothing is blocked)
{
  const dir = mkTmpDir();
  fs.mkdirSync(path.join(dir, '.claude-cpp-style'));
  fs.writeFileSync(path.join(dir, '.claude-cpp-style', 'cpp-style.json'), JSON.stringify({ enabled: false }));
  const f = path.join(dir, 'main.cpp');
  fs.writeFileSync(f, 'int main(){return 0;}');
  const before = fs.readFileSync(f);
  const r = runHook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.status, 0, 'enabled:false should exit 0');
  assert.strictEqual(r.stdout, '', 'enabled:false should leave stdout empty (no-op)');
  const stop = runStop(r.payload);
  assert.strictEqual(stop.stdout, '', 'enabled:false must not block at the closing step');
  assert.ok(fs.readFileSync(f).equals(before), 'enabled:false leaves the file untouched (no BOM and no final newline added)');
}

// 5) Protocol iron rule: never exit 2 / exit 1 under any circumstances
{
  const r = runHook({ tool_name: 'Edit', tool_input: {} });
  assert.notStrictEqual(r.status, 2, 'never exit 2');
  assert.notStrictEqual(r.status, 1, 'never exit 1');
}

// 6) The edit phase must not rewrite files: a rewrite makes Claude's next Edit fail with "file has been modified"
{
  const dir = bomOnlyProject();
  const f = path.join(dir, 'main.cpp');
  fs.writeFileSync(f, 'int main() { return 0; }\n');
  const before = fs.readFileSync(f);
  const r = runHook({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: f } });
  assert.strictEqual(r.stdout, '', 'PostToolUse only records and injects no output');
  assert.ok(fs.readFileSync(f).equals(before), 'PostToolUse does not rewrite the file immediately');
  const stop = runStop(r.payload);
  assert.ok(fs.readFileSync(f).subarray(0, 3).equals(BOM), 'Stop adds the BOM for the whole round');
  assert.strictEqual(JSON.parse(stop.stdout).decision, 'block', 'after a rewrite Claude is asked to review the final diff');
}

// 7) A failed tool result is not queued for automatic repair
{
  const dir = bomOnlyProject();
  const file = path.join(dir, 'failed.cpp');
  fs.writeFileSync(file, 'int  value;\n');
  const before = fs.readFileSync(file);
  const failed = runHook({ cwd: dir, tool_name: 'mcp__fs__edit_file',
    tool_input: { path: file }, tool_response: { isError: true } });
  assert.strictEqual(failed.status, 0);
  assert.strictEqual(runStop(failed.payload).stdout, '', 'a failed edit must not be queued for later automatic repair');
  assert.ok(fs.readFileSync(file).equals(before));
}

// 8) An MCP patch touching several files at once: Stop processes all of them
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
  assert.strictEqual(r.status, 0, 'post-patch processing should exit 0');
  assert.ok(!fs.readFileSync(a).subarray(0, 3).equals(BOM), 'PostToolUse does not add the BOM immediately');
  const stop = runStop(r.payload);
  assert.strictEqual(stop.status, 0, 'unified Stop processing should exit 0');
  assert.ok(fs.readFileSync(a).subarray(0, 3).equals(BOM), 'a.cpp gets a BOM');
  assert.ok(fs.readFileSync(b).subarray(0, 3).equals(BOM), 'b.hpp from a multi-file patch gets a BOM');
}

// 9) A subagent's edits are finished by its own SubagentStop; the main agent's Stop must not overstep
{
  const dir = bomOnlyProject();
  const f = path.join(dir, 'worker.cpp');
  fs.writeFileSync(f, 'int w;\n');
  const r = runHook({ cwd: dir, agent_id: 'agent-1', tool_name: 'Write', tool_input: { file_path: f } });
  const mainStop = runStop(r.payload);
  assert.strictEqual(mainStop.stdout, '', 'the main agent Stop does not consume the subagent bucket');
  assert.ok(!fs.readFileSync(f).subarray(0, 3).equals(BOM), 'the subagent file is still unprocessed after the main Stop');
  const subStop = runStop(r.payload, { hook_event_name: 'SubagentStop', agent_id: 'agent-1' });
  assert.strictEqual(JSON.parse(subStop.stdout).decision, 'block', 'SubagentStop makes the subagent review its own changes');
  assert.ok(fs.readFileSync(f).subarray(0, 3).equals(BOM), 'SubagentStop adds the BOM');
}

console.log('post_edit.integration.test.js PASS');
