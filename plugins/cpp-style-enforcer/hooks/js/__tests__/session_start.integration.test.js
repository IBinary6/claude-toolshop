const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'session_start.js');

// Use a temporary HOME to isolate the global template and avoid polluting the real ~/.claude
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-home-'));
const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
delete env.CLAUDE_PROJECT_DIR; // Keep the external environment from interfering with the cwd decision
const userTpl = path.join(tmpHome, '.claude', 'cpp-style-template.json');

const tmps = [];
function runHook(input = { hook_event_name: 'SessionStart' }) {
  const r = spawnSync('node', [entry], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 10000,
    env,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }
function mkGitRepo() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-repo-'));
  tmps.push(t);
  sh(['init'], t);
  return t;
}
function cfgPath(root) { return path.join(root, '.claude-cpp-style', 'cpp-style.json'); }

try {
  // 1) First run -> create the global template, no output, exit 0
  {
    const r = runHook();
    assert.strictEqual(r.status, 0, 'SessionStart should exit 0');
    assert.strictEqual(r.stdout, '', 'SessionStart should leave stdout empty (completely silent)');
    assert.strictEqual(r.stderr, '', 'SessionStart should leave stderr empty (completely silent)');
    assert.ok(fs.existsSync(userTpl), 'the first run should create the global template');
  }

  // 2) A user-customized template already exists -> never overwritten (byte-identical)
  {
    const custom = JSON.stringify({ enabled: true, mode: 'full', lineEnding: 'crlf' });
    fs.writeFileSync(userTpl, custom);
    const before = fs.readFileSync(userTpl);
    const r = runHook();
    assert.strictEqual(r.status, 0, 'the second run should exit 0');
    const after = fs.readFileSync(userTpl);
    assert.ok(before.equals(after), 'an existing template must stay byte-identical (the user customization is not overwritten)');
  }

  // 3) Merely opening a C++ project, before any edit, does not generate project config (no user task yet, so no project files are written).
  {
    const root = mkGitRepo();
    fs.writeFileSync(path.join(root, 'main.cpp'), 'int main(){return 0;}\n');
    const r = runHook({ hook_event_name: 'SessionStart', cwd: root });
    assert.strictEqual(r.status, 0, 'SessionStart in a C++ project should exit 0');
    assert.strictEqual(r.stdout, '', 'SessionStart in a C++ project should leave stdout empty');
    assert.strictEqual(r.stderr, '', 'SessionStart in a C++ project should leave stderr empty');
    assert.ok(!fs.existsSync(cfgPath(root)), 'SessionStart must not write into the project under review');
    assert.ok(!fs.existsSync(path.join(root, '.clang-format')), 'SessionStart must not write format config');
    assert.ok(!fs.existsSync(path.join(root, '.gitignore')), 'SessionStart must not rewrite .gitignore');
  }

  // 4) An existing cpp-style.json -> not overwritten (bytes unchanged)
  {
    const root = mkGitRepo();
    fs.writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(x)\n');
    const dir = path.join(root, '.claude-cpp-style');
    fs.mkdirSync(dir, { recursive: true });
    const custom = Buffer.from('{"enabled":false,"mode":"full"}\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'cpp-style.json'), custom);
    const r = runHook({ hook_event_name: 'SessionStart', cwd: root });
    assert.strictEqual(r.status, 0, 'SessionStart with an existing config should exit 0');
    assert.ok(fs.readFileSync(cfgPath(root)).equals(custom), 'an existing config must stay byte-identical (not overwritten)');
  }

  // 5) A non-git directory -> nothing generated
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-nogit-'));
    tmps.push(t);
    fs.writeFileSync(path.join(t, 'main.cpp'), 'int main(){}\n');
    const r = runHook({ hook_event_name: 'SessionStart', cwd: t });
    assert.strictEqual(r.status, 0, 'SessionStart in a non-git directory should exit 0');
    assert.ok(!fs.existsSync(cfgPath(t)), 'a non-git directory generates no config (no reliable project root)');
  }

  // 6) A git repo that is not a C++ project (pure python/js) -> nothing generated (conservative)
  {
    const root = mkGitRepo();
    fs.writeFileSync(path.join(root, 'app.py'), 'print(1)\n');
    fs.writeFileSync(path.join(root, 'index.js'), 'console.log(1)\n');
    const r = runHook({ hook_event_name: 'SessionStart', cwd: root });
    assert.strictEqual(r.status, 0, 'SessionStart in a non-C++ project should exit 0');
    assert.strictEqual(r.stdout, '', 'a non-C++ project should stay silent');
    assert.ok(!fs.existsSync(cfgPath(root)), 'a non-C++ project generates no config (conservative)');
  }

  console.log('session_start.integration.test.js PASS');
} finally {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (_) {} }
}
