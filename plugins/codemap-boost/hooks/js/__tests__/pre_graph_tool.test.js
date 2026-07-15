'use strict';

const assert = require('assert').strict;

const { hookCwd, run } = require('../pre_graph_tool/pre_graph_tool');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}\n    ${error && error.message}`);
    process.exitCode = 1;
  }
}

function deps(overrides = {}) {
  const writes = [];
  return {
    writes,
    readStdinJson: async () => ({ tool_input: { repo_root: 'D:/repo' } }),
    isGitRepo: () => true,
    commandExists: () => true,
    refreshCrgSync: () => true,
    output: (value) => writes.push(value),
    ...overrides,
  };
}

(async () => {
  assert.equal(hookCwd({ tool_input: { repo_root: 'D:/selected' } }, {}, 'D:/cwd'), 'D:/selected');
  assert.equal(hookCwd({}, { CLAUDE_WORKING_DIRECTORY: 'D:/env' }, 'D:/cwd'), 'D:/env');
  assert.equal(hookCwd({}, {}, 'D:/cwd'), 'D:/cwd');

  await test('non-git repo passes silently', async () => {
    const d = deps({ isGitRepo: () => false });
    const result = await run(d);
    assert.equal(result.allowed, true);
    assert.equal(d.writes.length, 0);
  });

  await test('missing code-review-graph denies graph MCP access', async () => {
    const d = deps({ commandExists: () => false });
    const result = await run(d);
    assert.equal(result.allowed, false);
    assert.equal(d.writes.length, 1);
    assert.equal(d.writes[0].hookSpecificOutput.permissionDecision, 'deny');
    assert.match(d.writes[0].hookSpecificOutput.permissionDecisionReason, /code-review-graph/);
  });

  await test('failed refresh denies graph MCP access', async () => {
    const d = deps({ refreshCrgSync: () => false });
    const result = await run(d);
    assert.equal(result.allowed, false);
    assert.equal(d.writes.length, 1);
    assert.equal(d.writes[0].hookSpecificOutput.permissionDecision, 'deny');
    assert.match(d.writes[0].hookSpecificOutput.permissionDecisionReason, /build\/update/);
  });

  await test('successful refresh passes silently', async () => {
    const d = deps();
    const result = await run(d);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'refreshed');
    assert.equal(d.writes.length, 0);
  });

  if (process.exitCode) process.exit(process.exitCode);
  console.log('pre_graph_tool.test.js PASS');
})();
