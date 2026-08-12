'use strict';

const assert = require('assert').strict;
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const START = path.resolve(__dirname, '..', 'subagent_start.js');
const STOP = path.resolve(__dirname, '..', 'subagent_stop.js');

function runHook(script, input) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-hook-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-hook-repo-'));
  const result = spawnSync('node', [script], {
    input: JSON.stringify({ cwd: repo, ...input }),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: repo,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  return { status: result.status, stdout: (result.stdout || '').trim() };
}

{
  const result = spawnSync('node', [START], {
    input: 'not-json',
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.equal((result.stdout || '').trim(), '');
}

{
  const result = runHook(START, { hook_event_name: 'SubagentStart', agent_id: 'agent-a' });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('不要运行任何 Git 命令'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Changed files:'));
}

{
  const result = runHook(STOP, {
    hook_event_name: 'SubagentStop',
    last_assistant_message: 'Validation: npm test',
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('Changed files'));
  assert.ok(parsed.reason.includes('Blockers'));
}

{
  const result = runHook(STOP, {
    hook_event_name: 'SubagentStop',
    last_assistant_message: 'Changed files: none\nValidation: npm test\nBlockers: none',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
}

{
  const result = runHook(STOP, {
    hook_event_name: 'SubagentStop',
    stop_hook_active: true,
    last_assistant_message: 'incomplete',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
}

console.log('✓ subagent_hooks.test.js — all assertions passed');
