const assert = require('node:assert');

const {
  PYTHON_PROBE_TIMEOUT_MS,
  pythonCandidates,
  resetPythonCacheForTests,
  resolvePython,
} = require('../lib/python');

// When the first candidate is already Python 3 return at once, so every cpplint run does not start other interpreters again.
{
  let calls = 0;
  const resolved = resolvePython({
    platform: 'darwin',
    env: {},
    spawnSync: () => { calls += 1; return { status: 0 }; },
  });
  assert.deepStrictEqual(resolved, { cmd: 'python3', args: [] });
  assert.strictEqual(calls, 1);
}

// macOS: when the first command does not exist probing must continue with python and must not abort early on ENOENT.
{
  const calls = [];
  const resolved = resolvePython({
    platform: 'darwin',
    env: {},
    spawnSync: (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'python3') return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: null };
      return { status: 0 };
    },
  });
  assert.deepStrictEqual(resolved, { cmd: 'python', args: [] });
  assert.deepStrictEqual(calls.map((call) => call.cmd), ['python3', 'python']);
  assert.ok(calls.every((call) => call.args.includes('-c')), 'the Python probe must run the version-check code');
}

// When an executable exists but is not Python 3 probing must continue, so Python 2 is never used by mistake.
{
  const resolved = resolvePython({
    platform: 'darwin',
    env: {},
    spawnSync: (cmd) => ({ status: cmd === 'python3' ? 1 : 0 }),
  });
  assert.deepStrictEqual(resolved, { cmd: 'python', args: [] });
}

// The Windows Python Launcher should pick any available Python 3 rather than pin a single 3.11 minor version.
{
  const candidates = pythonCandidates({ platform: 'win32', env: {} });
  assert.deepStrictEqual(candidates[0], { cmd: 'py', args: ['-3'] });
  assert.ok(!candidates.some((candidate) => candidate.args.includes('-3.11')));

  const resolved = resolvePython({
    platform: 'win32',
    env: {},
    spawnSync: (cmd, args) => ({ status: cmd === 'py' && args[0] === '-3' ? 0 : 1 }),
  });
  assert.deepStrictEqual(resolved, { cmd: 'py', args: ['-3'] });
}

// The default run path should cache the probe result, so every staged file does not start the Python candidates again.
{
  resetPythonCacheForTests();
  let calls = 0;
  const options = {
    platform: 'darwin',
    env: {},
    useCache: true,
    spawnSync: (_cmd, _args, spawnOptions) => {
      calls += 1;
      assert.strictEqual(spawnOptions.timeout, PYTHON_PROBE_TIMEOUT_MS);
      return { status: 0 };
    },
  };
  assert.deepStrictEqual(resolvePython(options), { cmd: 'python3', args: [] });
  assert.deepStrictEqual(resolvePython(options), { cmd: 'python3', args: [] });
  assert.strictEqual(calls, 1);
  resetPythonCacheForTests();
}

console.log('python.test.js PASS');
