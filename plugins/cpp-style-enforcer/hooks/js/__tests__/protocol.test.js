const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const libPath = path.join(__dirname, '..', 'lib', 'protocol.js').replace(/\\/g, '/');
const runnerDir = path.join(__dirname, 'fixtures');
fs.mkdirSync(runnerDir, { recursive: true });

function runFn(call) {
  const runner = path.join(runnerDir, 'protocol-runner.js');
  fs.writeFileSync(runner, `const p = require('${libPath}'); ${call}`);
  const r = spawnSync('node', [runner], { encoding: 'utf-8', timeout: 5000 });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

// passSilent: exit 0, empty stdout, empty stderr
let r = runFn('p.passSilent();');
assert.strictEqual(r.status, 0, 'passSilent exit 0');
assert.strictEqual(r.stdout, '', 'passSilent leaves stdout empty');
assert.strictEqual(r.stderr, '', 'passSilent leaves stderr empty');

// denyTool: exit 0, stdout is hookSpecificOutput.permissionDecision=deny
r = runFn('p.denyTool("NO_COMMIT");');
assert.strictEqual(r.status, 0, 'denyTool exit 0');
const deny = JSON.parse(r.stdout);
assert.strictEqual(deny.hookSpecificOutput.permissionDecision, 'deny', 'permissionDecision=deny');
assert.strictEqual(deny.hookSpecificOutput.permissionDecisionReason, 'NO_COMMIT', 'the reason is passed through');
console.log('protocol.test.js PASS');
