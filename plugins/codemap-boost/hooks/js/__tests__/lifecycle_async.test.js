'use strict';

const assert = require('assert').strict;
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..', '..', '..');
const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-lifecycle-'));

function commandHooks(eventName) {
  return (hooks[eventName] || []).flatMap((group) => group.hooks || []);
}

function runFast(relative) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(pluginRoot, relative)], {
    cwd: tmp,
    env: { ...process.env, CLAUDE_WORKING_DIRECTORY: tmp },
    encoding: 'utf8',
    windowsHide: process.platform === 'win32',
    timeout: 3000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 2000, `${relative} launcher must return immediately`);
}

try {
  for (const eventName of ['SessionStart', 'SessionEnd']) {
    for (const hook of commandHooks(eventName)) {
      assert.notEqual(hook.async, true, `${eventName} must not use Cursor's racy async adapter`);
    }
  }

  runFast('hooks/js/crg_build/crg_build.js');
  runFast('hooks/js/graphify_build/graphify_build.js');

  const cwdKey = crypto.createHash('sha1').update(tmp).digest('hex').slice(0, 16);
  const stale = path.join(os.tmpdir(), `crg-update-run-${cwdKey}.lock`);
  fs.writeFileSync(stale, 'stale', 'utf8');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  runFast('hooks/js/crg_stop/crg_stop.js');

  const deadline = Date.now() + 3000;
  while (fs.existsSync(stale) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  assert.equal(fs.existsSync(stale), false, 'detached SessionEnd worker still removes stale locks');
  console.log('lifecycle_async.test.js PASS');
} finally {
  const deadline = Date.now() + 5000;
  while (fs.existsSync(tmp)) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    if (!fs.existsSync(tmp) || Date.now() >= deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert.equal(fs.existsSync(tmp), false, 'detached lifecycle workers release their working directory');
}
