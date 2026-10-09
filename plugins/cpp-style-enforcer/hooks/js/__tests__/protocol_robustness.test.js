'use strict';

// Hook protocol robustness tests (gaps in the official protocol):
//   Gap A: malformed stdin must not crash - feed post_edit.js / pre_commit.js all kinds of malformed input; both exit 0 without crashing.
//   Gap B: stdout purity - in the Stop block scenario stdout is a single valid JSON after trim, with no diagnostic text mixed in.
//   Gap C: the block path does not depend on an if(hasPython) bypass - with python on this machine the block is asserted unconditionally.
//
// Note: gaps B/C need python (the repo ships hooks/js/cpplint/cpplint.py, so no pip install of cpplint is needed).
//       Gap A needs no external tool.

const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolvePython } = require('../lib/python');

const postEdit = path.join(__dirname, '..', 'post_edit.js');
const stopCheck = path.join(__dirname, '..', 'stop_check.js');
const preCommit = path.join(__dirname, '..', 'pre_commit.js');

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

// Isolate HOME so the real global template is not read
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-rbhome-'));
const env = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  CLAUDE_PLUGIN_DATA: path.join(fakeHome, 'plugin-data'),
};

const repos = [];
function newRepo(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'cse-rb-'));
  repos.push(tmp);
  sh(['init'], tmp);
  sh(['config', 'user.email', 't@t.com'], tmp);
  sh(['config', 'user.name', 't'], tmp);
  sh(['config', 'commit.gpgsign', 'false'], tmp);
  return tmp;
}

// Feed raw strings to stdin (not JSON.stringify) to build malformed input
function runRaw(entry, rawInput, cwd) {
  const r = spawnSync('node', [entry], {
    input: rawInput, encoding: 'utf-8', timeout: 30000, env, cwd,
  });
  return { status: r.status, stdout: (r.stdout || ''), stderr: (r.stderr || '') };
}

const hasPython = resolvePython() !== null;

// Valid output contract: either empty, or a single valid JSON after trim
function assertCleanStdout(stdout, ctx) {
  const t = stdout.trim();
  if (t === '') return;
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(t); },
    `${ctx}: non-empty stdout must be valid JSON (after trim), actual=${JSON.stringify(stdout)}`);
  // The whole stdout after trim is that JSON; re-serializing round-trips (no extra log lines mixed in)
  assert.strictEqual(t, JSON.stringify(parsed), `${ctx}: stdout must be exactly one JSON value with no extra text`);
}

try {
  // ====== Gap A: post_edit.js must not crash on malformed stdin ======
  const repoA = newRepo('cse-rb-a-');
  const malformedInputs = [
    ['invalid JSON', '{bad json'],
    ['empty stdin', ''],
    ['missing tool_input field', '{"tool_name":"Write"}'],
    ['tool_input without file_path', '{"tool_name":"Write","tool_input":{}}'],
    ['file_path pointing to a nonexistent file',
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(repoA, 'ghost.cpp') } })],
  ];
  for (const [name, raw] of malformedInputs) {
    const r = runRaw(postEdit, raw, repoA);
    assert.strictEqual(r.status, 0, `post_edit malformed input [${name}]: must exit 0 without crashing (actual status=${r.status}, stderr=${r.stderr})`);
    assertCleanStdout(r.stdout, `post_edit malformed input [${name}]`);
  }

  // ====== Gap A: pre_commit.js malformed stdin / missing command ======
  const repoPC = newRepo('cse-rb-pc-');
  const preMalformed = [
    ['invalid JSON', '{bad json'],
    ['empty stdin', ''],
    ['missing command field', '{"tool_name":"Bash","tool_input":{}}'],
    ['missing tool_input field', '{"tool_name":"Bash"}'],
  ];
  for (const [name, raw] of preMalformed) {
    const r = runRaw(preCommit, raw, repoPC);
    assert.strictEqual(r.status, 0, `pre_commit malformed input [${name}]: must exit 0 without crashing (actual status=${r.status}, stderr=${r.stderr})`);
    assertCleanStdout(r.stdout, `pre_commit malformed input [${name}]`);
  }

  // C-style cast: clang-format does not fix it, so after the full pipeline cpplint must report readability/casting.
  const VIOLATION_CPP = 'int main() {\n  double d = 3.5;\n  int y = (int)d;\n  return y;\n}\n';

  // ====== Gap B + Gap C: the block path is asserted unconditionally (not bypassed when python exists on this machine) ======
  // Gap C approach: "assert unconditionally when python exists". This machine has python 3.x plus the repo's own cpplint.py,
  // so without python the environment is declared unfit (an error instead of a silent skip), which guarantees the block path is verified.
  assert.ok(hasPython,
    'gap C: this test needs python + the bundled cpplint.py; this environment has no python, so the block path cannot be verified');

  // PostToolUse only records; Stop runs cpplint on the new file and emits a clean decision:block JSON.
  {
    const repo = newRepo('cse-rb-block-');
    const f = path.join(repo, 'new.cpp');
    fs.writeFileSync(f, VIOLATION_CPP);  // Untracked new file -> runs the full pipeline
    const hookInput = {
      session_id: 'robust-session',
      tool_use_id: 'robust-tool',
      cwd: repo,
      tool_name: 'Write',
      tool_input: { file_path: f },
    };
    const post = runRaw(postEdit, JSON.stringify(hookInput), repo);
    assert.strictEqual(post.status, 0, 'block: post_edit recording still exits 0');
    assert.strictEqual(post.stdout.trim(), '', 'block: post_edit does not check ahead of time');
    const r = runRaw(stopCheck, JSON.stringify({
      session_id: hookInput.session_id,
      cwd: repo,
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }), repo);
    assert.strictEqual(r.status, 0, 'block: Stop still exits 0 on a violation (never exit 2)');
    const t = r.stdout.trim();
    assert.ok(t.length > 0, 'block: a violation must produce stdout');
    // Gap B: stdout is a single valid JSON after trim and contains no diagnostic text
    assertCleanStdout(r.stdout, 'block stop_check');
    const parsed = JSON.parse(t);
    assert.strictEqual(parsed.decision, 'block', 'block: decision:block');
    assert.ok(typeof parsed.reason === 'string' && parsed.reason.length > 0, 'block: reason is non-empty');
  }

  // pre_commit deny: a staged .cpp with violations + a real commit (mode:full) -> exit 0 + a clean deny JSON on stdout
  {
    const repo = newRepo('cse-rb-deny-');
    const cfgDir = path.join(repo, '.claude-cpp-style');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ mode: 'full' }));
    const f = path.join(repo, 'bad.cpp');
    fs.writeFileSync(f, VIOLATION_CPP);
    sh(['add', 'bad.cpp'], repo);
    const r = runRaw(preCommit,
      JSON.stringify({ cwd: repo, tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } }), repo);
    assert.strictEqual(r.status, 0, 'deny: pre_commit still exits 0');
    const t = r.stdout.trim();
    assert.ok(t.length > 0, 'deny: a staged violation must produce stdout');
    // Gap B: stdout purity
    assertCleanStdout(r.stdout, 'deny pre_commit');
    const parsed = JSON.parse(t);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny', 'deny: permissionDecision:deny');
    assert.ok(parsed.hookSpecificOutput.permissionDecisionReason.length > 0, 'deny: reason is non-empty');
  }

  console.log('protocol_robustness.test.js PASS');
} finally {
  for (const r of repos) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {}
  }
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch (_) {}
}
