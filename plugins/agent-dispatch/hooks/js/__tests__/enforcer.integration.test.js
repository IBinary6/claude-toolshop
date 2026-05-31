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
  assert.ok(parsed.reason.includes('BLOCKED'), `reason should mention BLOCKED: ${parsed.reason}`);
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

// --- MCP prefix whitelist ---
{
  const r = runHook({ tool_name: 'mcp__plugin_context-mode_ctx_execute', tool_input: {} });
  assertPass(r);
}
{
  const r = runHook({ tool_name: 'mcp__plugin_claude-mem_search', tool_input: {} });
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

// --- unknown command → block ---
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assertBlock(r, 'Bash');
}
{
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'python script.py' } });
  assertBlock(r, 'Bash');
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

console.log('✓ enforcer.integration.test.js — all assertions passed');
