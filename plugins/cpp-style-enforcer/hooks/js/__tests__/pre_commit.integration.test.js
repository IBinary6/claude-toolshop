const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('child_process');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'pre_commit.js');
const cleanupFailureFixture = path.join(__dirname, 'fail_snapshot_cleanup.cjs');
const stagedDiffFailureFixture = path.join(__dirname, 'fail_staged_diff.cjs');
const { commitCwd, isGitCommit, stagedCppFiles } = require(path.join(pluginRoot, 'hooks', 'js', 'pre_commit.js'));

function runHook(command, cwd = process.cwd(), inputCwd = undefined, nodeArgs = []) {
  const r = spawnSync(process.execPath, [...nodeArgs, entry], {
    cwd,
    input: JSON.stringify({ tool_name: 'Bash', cwd: inputCwd, tool_input: { command } }),
    encoding: 'utf-8',
    timeout: 30000,
    windowsHide: process.platform === 'win32',
  });
  return { status: r.status, stdout: (r.stdout || '').trim() };
}

function git(args, cwd) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10000,
    windowsHide: process.platform === 'win32',
  });
  assert.strictEqual(r.status, 0, r.stderr);
}

const CLEAN_CPP = Buffer.from('int main() { return 0; }\n', 'utf8');
const VIOLATION_CPP = Buffer.from(
  'int main() {\n  double d = 3.5;\n  int y = (int)d;\n  return y;\n}\n',
  'utf8',
);

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

// isGitCommit unit assertions: real commits match, false positives pass through
assert.strictEqual(isGitCommit('git commit -m "x"'), true, 'a real git commit should match');
assert.strictEqual(isGitCommit('git commit'), true, 'a bare git commit should match');
assert.strictEqual(isGitCommit('  git   commit  --amend'), true, 'git commit with extra spaces should match');
assert.strictEqual(isGitCommit('git -C repo commit -m "x"'), true, 'git -C repo commit should match');
assert.strictEqual(isGitCommit('git -c user.name=x commit -m "x"'), true, 'git -c ... commit should match');
assert.strictEqual(isGitCommit('cd repo; git commit -m "x"'), true, 'git commit inside a compound command should match');
assert.strictEqual(isGitCommit('cmd /c git commit -m "x"'), true, 'cmd /c git commit should match');
assert.strictEqual(isGitCommit('GIT COMMIT -m "x"'), true, 'GIT COMMIT in a different case should match');
assert.strictEqual(isGitCommit('git.exe commit -m "x"'), true, 'Windows git.exe commit should match');
assert.strictEqual(isGitCommit('/usr/bin/git commit -m "x"'), true, 'an absolute-path git commit should match');
assert.strictEqual(isGitCommit('"C:\\Program Files\\Git\\cmd\\git.exe" commit -m "x"'), true,
  'a Windows absolute path with spaces to git.exe commit should match');
assert.strictEqual(isGitCommit('cmd.exe /C git.exe COMMIT -m "x"'), true, 'git.exe commit wrapped by cmd /c should match');
assert.strictEqual(isGitCommit('cmd /c "C:\\Program Files\\Git\\cmd\\git.exe" commit -m "x"'), true,
  'an absolute path with spaces to git.exe commit wrapped by cmd /c should match');
assert.strictEqual(isGitCommit('cmd.exe /d /s /c git.exe commit -m "x"'), true,
  'a /c wrapper with common cmd switches should match');
assert.strictEqual(isGitCommit('& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m "x"'), true,
  'the PowerShell call operator running an absolute-path git.exe commit should match');
assert.strictEqual(isGitCommit('command git commit -m "x"'), true, 'git commit wrapped by command should match');
assert.strictEqual(isGitCommit('echo "git commit"'), false, 'git commit inside echo should not match');
assert.strictEqual(isGitCommit('git commit-graph write'), false, 'commit-graph should not match');
assert.strictEqual(isGitCommit('git commit-tree HEAD^{tree}'), false, 'commit-tree should not match');
assert.strictEqual(isGitCommit('git status'), false, 'git status should not match');

{
  const base = path.resolve('base');
  assert.strictEqual(commitCwd('git commit', base), base);
  assert.strictEqual(commitCwd('git -C repo commit -m "x"', base), path.join(base, 'repo'));
  assert.strictEqual(commitCwd('cd repo; git commit -m "x"', base), path.join(base, 'repo'));
  assert.strictEqual(commitCwd('git.exe -C repo commit -m "x"', base), path.join(base, 'repo'));
  assert.strictEqual(commitCwd('cd /d "repo with space" && git.exe commit -m "x"', base),
    path.join(base, 'repo with space'));
  assert.strictEqual(commitCwd('cmd /c "cd /d repo && git.exe commit -m x"', base),
    path.join(base, 'repo'), 'a cd inside cmd quotes must decide the real commit directory');
}

// Git -z output must keep spaces, non-ASCII names and shell metacharacters intact; on POSIX it also covers newlines inside file names.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-paths-'));
  try {
    git(['init'], tmp);
    const names = ['src/with space.cc', 'src/\u4e2d\u6587.cpp', 'src/hash#bracket[1].hpp'];
    if (process.platform !== 'win32') names.push('src/line\nbreak.cc');
    for (const name of names) writeBytes(path.join(tmp, ...name.split('/')), CLEAN_CPP);
    git(['add', '--', ...names], tmp);

    const actual = stagedCppFiles(tmp).map((filePath) => path.relative(tmp, filePath).split(path.sep).join('/'));
    assert.deepStrictEqual(actual.sort(), [...names].sort(), 'staged file names must be parsed completely at NUL boundaries');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A non-commit command -> passSilent (exit 0, empty stdout)
{
  const r = runHook('git status');
  assert.strictEqual(r.status, 0, 'a non-commit command should exit 0');
  assert.strictEqual(r.stdout, '', 'a non-commit command should leave stdout empty');
}

// echo containing git commit -> no lint, passSilent
{
  const r = runHook('echo "git commit"');
  assert.strictEqual(r.status, 0, 'echo should exit 0');
  assert.strictEqual(r.stdout, '', 'echo should leave stdout empty');
}

// When the repo targeted by git -C has staged C++ violations, the target repo is checked, not the hook process cwd.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-scope-'));
  try {
    const repoA = path.join(tmp, 'repo-a');
    const repoB = path.join(tmp, 'repo-b');
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    git(['init'], repoA);
    git(['init'], repoB);
    fs.writeFileSync(path.join(repoB, 'bad.cc'), '#include <vector>\nusing namespace std;\nint main(){return 0;}\n', 'utf8');
    git(['add', 'bad.cc'], repoB);

    const r = runHook(`git -C "${repoB}" commit -m "x"`, repoA);
    assert.strictEqual(r.status, 0, 'the hook protocol requires exit 0');
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(payload.hookSpecificOutput.permissionDecisionReason.includes('bad.cc'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// When the index holds LF and the working tree was later changed to CRLF with violations, the clean index version must be checked, not the working tree.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-index-lf-'));
  try {
    git(['init'], tmp);
    const source = path.join(tmp, 'src', 'main.cc');
    writeBytes(source, CLEAN_CPP);
    git(['add', 'src/main.cc'], tmp);

    const worktreeViolation = Buffer.from(VIOLATION_CPP.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    writeBytes(source, worktreeViolation);
    const before = fs.readFileSync(source);

    const r = runHook(`git commit -m "x"`, tmp);
    assert.strictEqual(r.status, 0, 'the clean staged version should pass the commit check');
    assert.strictEqual(r.stdout, '', 'the clean staged version should pass silently');
    assert.ok(fs.readFileSync(source).equals(before), 'the commit check must not rewrite a CRLF working tree');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// When the index holds LF with violations and the working tree later became clean CRLF, the commit must still be blocked by the index version.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-index-violation-'));
  try {
    git(['init'], tmp);
    const source = path.join(tmp, 'src', 'main.cc');
    writeBytes(source, VIOLATION_CPP);
    git(['add', 'src/main.cc'], tmp);

    const worktreeClean = Buffer.from(CLEAN_CPP.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    writeBytes(source, worktreeClean);
    const before = fs.readFileSync(source);

    const r = runHook(`git commit -m "x"`, tmp);
    assert.strictEqual(r.status, 0, 'the hook protocol requires exit 0');
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny',
      'a violating staged version must block the commit');
    assert.ok(payload.hookSpecificOutput.permissionDecisionReason.includes('src/main.cc'));
    assert.ok(fs.readFileSync(source).equals(before), 'the commit check must not rewrite a CRLF working tree');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// CPPLINT.cfg must also come from the index: a staged config that turns off the casting check must take effect even if the working tree turned it back on.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-index-cpplint-'));
  try {
    git(['init'], tmp);
    const source = path.join(tmp, 'src', 'main.cc');
    const config = path.join(tmp, 'CPPLINT.cfg');
    writeBytes(source, VIOLATION_CPP);
    writeBytes(config, Buffer.from('set noparent\nfilter=-readability/casting\n', 'utf8'));
    git(['add', 'src/main.cc', 'CPPLINT.cfg'], tmp);

    const worktreeConfig = Buffer.from('set noparent\nfilter=+readability/casting\n', 'utf8');
    writeBytes(config, worktreeConfig);
    const before = fs.readFileSync(config);

    const r = runHook(`git commit -m "x"`, tmp);
    assert.strictEqual(r.status, 0, 'a staged CPPLINT.cfg should let the matching source pass');
    assert.strictEqual(r.stdout, '', 'a staged CPPLINT.cfg in effect should pass silently');
    assert.ok(fs.readFileSync(config).equals(before), 'the commit check must not rewrite the working-tree CPPLINT.cfg');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// When the staged files cannot be listed the check is incomplete; the commit must be explicitly rejected, not treated as "no C++ files".
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-staged-diff-failure-'));
  try {
    git(['init'], tmp);
    writeBytes(path.join(tmp, 'clean.cc'), CLEAN_CPP);
    git(['add', 'clean.cc'], tmp);

    const r = runHook('git commit -m "x"', tmp, undefined, ['--require', stagedDiffFailureFixture]);
    assert.strictEqual(r.status, 0, 'the hook protocol requires exit 0 even when rejecting the commit');
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /staged files|git diff/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A snapshot cleanup failure makes the check incomplete; the commit must be explicitly rejected and must not fall into the top-level fail-open.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-cleanup-failure-'));
  try {
    git(['init'], tmp);
    writeBytes(path.join(tmp, 'clean.cc'), CLEAN_CPP);
    git(['add', 'clean.cc'], tmp);

    const r = runHook('git commit -m "x"', tmp, undefined, ['--require', cleanupFailureFixture]);
    assert.strictEqual(r.status, 0, 'the hook protocol requires exit 0 even when rejecting the commit');
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /clean.*snapshot|snapshot.*clean/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// With legacyChecks.cpplint explicitly enabled, previously committed files must be checked too.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-legacy-checks-'));
  try {
    git(['init'], tmp);
    git(['config', 'user.email', 'test@example.invalid'], tmp);
    git(['config', 'user.name', 'test'], tmp);
    git(['config', 'commit.gpgsign', 'false'], tmp);
    writeBytes(path.join(tmp, 'legacy.cc'), CLEAN_CPP);
    git(['add', 'legacy.cc'], tmp);
    git(['commit', '-m', 'baseline'], tmp);
    writeBytes(path.join(tmp, '.claude-cpp-style', 'cpp-style.json'), Buffer.from(JSON.stringify({
      mode: 'incremental', checks: { cpplint: false },
      legacyChecks: { cpplint: true },
    })));
    writeBytes(path.join(tmp, 'legacy.cc'), VIOLATION_CPP);
    git(['add', 'legacy.cc'], tmp);
    const result = runHook('git commit -m "check legacy"', tmp);
    assert.strictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /legacy.cc/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('pre_commit.integration.test.js PASS');
