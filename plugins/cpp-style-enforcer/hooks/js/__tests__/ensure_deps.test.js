const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  ensureIconvLite,
  ensureClangFormat,
  detectClangFormat,
  markerPath,
  spawnPrewarm,
} = require('../lib/ensure_deps.js');

const pluginRoot = path.join(__dirname, '..', '..', '..');

// ---- ensureIconvLite: when already installed return the module directly and never trigger an install ----
{
  // iconv-lite is declared in the plugin dependencies, so require hits it in this repo (the dev machine ran npm install).
  // If this environment happens not to have it, fall back to verifying "degrades safely: returns null and does not throw".
  // Use an isolated marker so the plugin root is not polluted.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-present-'));
  try {
    let installAttempted = false;
    const mod = ensureIconvLite({
      marker: path.join(tmp, '.iconv-install-failed'),
      install: () => { installAttempted = true; return false; },
    });
    if (mod) {
      assert.strictEqual(typeof mod.decode, 'function', 'iconv-lite installed -> returns a module with decode');
      assert.strictEqual(installAttempted, false, 'iconv-lite installed -> never triggers an install');
      console.log('ensure_deps: iconvLite present, no install PASS');
    } else {
      assert.strictEqual(mod, null, 'iconv-lite missing and install failing -> returns null');
      assert.strictEqual(installAttempted, false, 'by default only detects; never installs on a hook path');
      console.log('ensure_deps: iconvLite absent, degrade null PASS');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureIconvLite: the marker file exists (failed before) -> no install retry, degrade to null directly ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-mk-'));
  try {
    const marker = path.join(tmp, '.iconv-install-failed');
    fs.writeFileSync(marker, '1');
    let installAttempted = false;
    // Force require to fail by injection: use a name that can never be required to simulate "missing"
    const mod = ensureIconvLite({
      moduleName: '__definitely_missing_iconv__',
      marker,
      install: () => { installAttempted = true; return false; },
    });
    assert.strictEqual(mod, null, 'missing + existing failure marker -> returns null');
    assert.strictEqual(installAttempted, false, 'an existing failure marker -> no install attempt');
    console.log('ensure_deps: iconvLite marker skips retry PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureIconvLite: missing + no marker + install still fails -> writes the marker + returns null + does not throw ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-fail-'));
  try {
    const marker = path.join(tmp, '.iconv-install-failed');
    let installAttempted = false;
    const mod = ensureIconvLite({
      moduleName: '__definitely_missing_iconv__',
      marker,
      allowInstall: true,
      install: () => { installAttempted = true; return false; }, // Simulate an install failure
    });
    assert.strictEqual(mod, null, 'missing + install failure -> null');
    assert.strictEqual(installAttempted, true, 'missing + no marker -> one install attempt');
    assert.ok(fs.existsSync(marker), 'after an install failure a failure marker is written to avoid retrying next time');
    console.log('ensure_deps: iconvLite install fail writes marker PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- detectClangFormat: with an injected probe, PATH (clang-format) hits first -> returns the PATH descriptor ----
{
  const probed = [];
  const desc = detectClangFormat({
    probe: (d) => { probed.push(d); return d.cmd === 'clang-format'; },
    scriptsDirs: () => [],
  });
  assert.deepStrictEqual(desc, { cmd: 'clang-format', args: [] }, 'PATH hit -> returns the PATH invocation descriptor');
  assert.deepStrictEqual(probed[0], { cmd: 'clang-format', args: [] }, 'probes clang-format on PATH first');
  console.log('ensure_deps: detect PATH desc PASS');
}

// ---- detectClangFormat: not on PATH but python -m clang_format works -> returns the python descriptor ----
{
  const desc = detectClangFormat({
    probe: (d) => d.cmd === 'python' && d.args[0] === '-m' && d.args[1] === 'clang_format',
    scriptsDirs: () => [],
    pythons: () => [{ cmd: 'python', args: [] }],
  });
  assert.deepStrictEqual(desc, { cmd: 'python', args: ['-m', 'clang_format'] },
    'not on PATH + python -m clang_format works -> returns the python module invocation descriptor');
  console.log('ensure_deps: detect python -m clang_format desc PASS');
}

// ---- detectClangFormat: only the executable in the Scripts directory works -> returns that absolute-path descriptor ----
{
  const scriptExe = { cmd: '/fake/Scripts/clang-format', args: [] };
  const desc = detectClangFormat({
    probe: (d) => d.cmd === scriptExe.cmd,
    scriptsDirs: () => [scriptExe],
  });
  assert.deepStrictEqual(desc, scriptExe, 'only the Scripts-directory executable works -> returns that path invocation descriptor');
  console.log('ensure_deps: detect Scripts-dir desc PASS');
}

// ---- detectClangFormat: nothing works -> returns null ----
{
  const desc = detectClangFormat({ probe: () => false, scriptsDirs: () => [] });
  assert.strictEqual(desc, null, 'no invocation method runs -> returns null');
  console.log('ensure_deps: detect none -> null PASS');
}

// ---- ensureClangFormat: clang-format on PATH -> returns the invocation descriptor and does not trigger pip ----
{
  const hasClangFormat = spawnSync('clang-format', ['--version'], { stdio: 'pipe' }).status === 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-present-'));
  try {
    let installAttempted = false;
    const desc = ensureClangFormat({
      marker: path.join(tmp, '.clang-format-install-failed'),
      install: () => { installAttempted = true; return false; },
    });
    if (hasClangFormat) {
      assert.deepStrictEqual(desc, { cmd: 'clang-format', args: [] },
        'clang-format on PATH -> returns the PATH invocation descriptor');
      assert.strictEqual(installAttempted, false, 'clang-format on PATH -> never triggers a pip install');
      console.log('ensure_deps: clangFormat present, no install PASS');
    } else {
      assert.strictEqual(desc, null, 'missing + install failure -> null');
      assert.strictEqual(installAttempted, false, 'by default only detects; never installs on a hook path');
      console.log('ensure_deps: clangFormat absent, degrade null PASS');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: after a successful install the python descriptor is detected -> returns the python invocation descriptor ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-pip-'));
  try {
    let detectCalls = 0;
    const pythonDesc = { cmd: 'python', args: ['-m', 'clang_format'] };
    const desc = ensureClangFormat({
      marker: path.join(tmp, '.clang-format-install-failed'),
      detect: () => { detectCalls += 1; return detectCalls === 1 ? null : pythonDesc; },
      allowInstall: true,
      install: () => true, // Simulate a successful pip install
    });
    assert.deepStrictEqual(desc, pythonDesc, 'after pip install, python -m clang_format is detected -> returns that invocation descriptor');
    assert.strictEqual(detectCalls, 2, 'detects once before and once after the install');
    console.log('ensure_deps: clangFormat pip then python desc PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: missing + an existing failure marker -> no retry ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-mk-'));
  try {
    const marker = path.join(tmp, '.clang-format-install-failed');
    fs.writeFileSync(marker, '1');
    let installAttempted = false;
    const cmd = ensureClangFormat({
      detect: () => null, // Force "not detected"
      marker,
      install: () => { installAttempted = true; return false; },
    });
    assert.strictEqual(cmd, null, 'missing + failure marker -> null');
    assert.strictEqual(installAttempted, false, 'a failure marker exists -> no more pip install');
    console.log('ensure_deps: clangFormat marker skips retry PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: an exception thrown by install does not bubble up; returns null safely ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-throw-'));
  try {
    const marker = path.join(tmp, '.clang-format-install-failed');
    const cmd = ensureClangFormat({
      detect: () => null,
      marker,
      allowInstall: true,
      install: () => { throw new Error('boom'); },
    });
    assert.strictEqual(cmd, null, 'install throws -> caught and null returned (does not bubble up)');
    console.log('ensure_deps: clangFormat install throw safe PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- markerPath: with PLUGIN_DATA use the persistent data dir; when missing never pollute the plugin root ----
{
  const oldData = process.env.CLAUDE_PLUGIN_DATA;
  try {
    delete process.env.CLAUDE_PLUGIN_DATA;
    const fallback = markerPath('.iconv-install-failed');
    assert.ok(path.isAbsolute(fallback), 'markerPath fallback returns an absolute path');
    assert.ok(fallback.endsWith('.iconv-install-failed'), 'markerPath fallback keeps the file name');
    assert.ok(!path.resolve(fallback).startsWith(path.resolve(pluginRoot)),
      'without CLAUDE_PLUGIN_DATA the failure marker must not be written into the plugin root, or a marketplace update would dirty the worktree');

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-plugin-data-'));
    process.env.CLAUDE_PLUGIN_DATA = dataDir;
    const dataMarker = markerPath('.clang-format-install-failed');
    assert.strictEqual(path.dirname(dataMarker), dataDir, 'with CLAUDE_PLUGIN_DATA the marker goes to the persistent data directory');
    fs.rmSync(dataDir, { recursive: true, force: true });
  } finally {
    if (oldData === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = oldData;
    }
  }
  console.log('ensure_deps: markerPath PASS');
}

// ---- spawnPrewarm: the background detached start neither blocks nor throws ----
{
  const child = spawnPrewarm();
  // Returns the child handle or null (a spawn failure does not throw either)
  assert.ok(child === null || typeof child.pid === 'number' || child.pid === undefined,
    'spawnPrewarm returns a child process or null and does not throw');
  if (child && typeof child.unref === 'function') {
    // Already unref'd; it does not keep the test process from exiting
  }
  console.log('ensure_deps: spawnPrewarm non-blocking PASS');
}

console.log('ensure_deps.test.js PASS');
