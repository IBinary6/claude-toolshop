'use strict';
const assert = require('assert').strict;
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ENFORCER = path.resolve(__dirname, '..', 'enforcer.js');

function runHook(input, envOverrides = {}) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dispatch-test-'));
  const env = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    ...envOverrides,
  };
  const r = spawnSync('node', [ENFORCER], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env,
  });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: r.stderr || '' };
}

function assertPass(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}`);
  assert.equal(result.stdout, '', `expected empty stdout, got: ${result.stdout}`);
}

function assertBlock(result, toolName) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}`);
  assert.notEqual(result.stdout, '', 'expected block JSON output');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('拦截'), `reason should mention 拦截: ${parsed.reason}`);
  if (toolName) {
    assert.ok(parsed.reason.includes(toolName), `reason should mention ${toolName}: ${parsed.reason}`);
  }
}

// --- subagent exemption ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' }, agent_id: 'sub-123' });
  assertPass(r);
}

// --- whitelisted tool (Read is in whitelist but wouldn't match the hook matcher in prod,
//     however enforcer.js still checks whitelist internally for robustness) ---
{
  const r = runHook({ tool_name: 'Write', tool_input: { file_path: '/tmp/x.txt', content: 'hi' } });
  assertPass(r);
}

// --- MCP prefix whitelist (短格式不在 block_exact 名单中，仍通过前缀白名单放行) ---
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_ctx_execute', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__plugin_claude-mem_search', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__code_review_graph__get_minimal_context_tool', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__codegraph__search', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__graphify__query', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__code-review-graph__semantic_search_nodes_tool', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__codegraph__context', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__graphify__build', tool_input: {} });
  assertPass(r);
}

// --- mcp_block_exact: 精确 deny 名单优先于前缀白名单 ---
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_execute', tool_input: { language: 'shell', code: 'npm test' } });
  assertBlock(r, 'mcp__plugin_context-mode_context-mode__ctx_execute');
}
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_execute_file', tool_input: {} });
  assertBlock(r, 'mcp__plugin_context-mode_context-mode__ctx_execute_file');
}
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_batch_execute', tool_input: {} });
  assertBlock(r, 'mcp__plugin_context-mode_context-mode__ctx_batch_execute');
}

// --- 只读 context-mode 工具仍通过前缀白名单放行 ---
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_search', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_index', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_context-mode__ctx_stats', tool_input: {} });
  assertPass(r);
}

// --- safe Bash ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'ls -la && fd -t f .' } });
  assertPass(r);
}

// --- dangerous git → block ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'git push --force' } });
  assertBlock(r, 'Bash');
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' } });
  assertBlock(r, 'Bash');
}

// --- 默认安全 Bash head → pass ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'python script.py' } });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'codegraph sync && graphify --version' } });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'codegraph status && graphify --version' } });
  assertPass(r);
}

// --- heavy MCP → block ---
{
  const r = runHook({ tool_name: 'mcp__context7__query-docs', tool_input: {} });
  assertBlock(r, 'mcp__context7__query-docs');
}
{
  const r = runHook({ tool_name: 'mcp__tavily-cross-platform__search', tool_input: {} });
  assertBlock(r, 'mcp__tavily');
}

// --- malformed stdin → silent exit ---
{
  const r = runHook('not json at all');
  assertPass(r);
}
{
  const r = runHook('');
  assertPass(r);
}
{
  const r = runHook('{bad json');
  assertPass(r);
}

// --- command substitution → block ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'echo $(whoami)' } });
  assertBlock(r, 'Bash');
}

// --- enforcer disabled via config ---
// We test by creating a temp project dir with .agent-dispatch.json that disables enforcer
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-disabled-'));
  fs.writeFileSync(path.join(tmpDir, '.agent-dispatch.json'), JSON.stringify({
    modules: { enforcer: false }
  }));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-home-'));
  const r = spawnSync('node', [ENFORCER], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: tmpDir,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  assert.equal(r.status, 0);
  assert.equal((r.stdout || '').trim(), '', 'enforcer disabled should pass through');
}

// --- block message format validation (中文短版) ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'unknown-tool --version' } });
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.reason.includes('⛔🔒 拦截'), 'block 消息应包含 ⛔🔒 拦截 标识');
  assert.ok(parsed.reason.includes('Bash'), 'block 消息应包含被拦截的工具名');
  assert.ok(parsed.reason.includes('Agent'), 'block 消息应包含 Agent 委派示例');
  assert.ok(parsed.reason.split('\n').length <= 3, 'block 消息应不超过 3 行（精简版）');
  // 防缓存失效：必须提示子代理改文件后回传被改文件路径，主 agent 才能重读保持一致
  assert.ok(/列出路径|修改.*文件.*路径|文件.*路径/.test(parsed.reason),
    'block 消息应提示子代理回传被修改的文件路径（防主 agent 缓存失效）');
}

console.log('✓ enforcer.integration.test.js — all assertions passed');
