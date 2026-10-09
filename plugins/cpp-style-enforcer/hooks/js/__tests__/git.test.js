const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, isNew, changedLineRanges } = require('../lib/git.js');

function sh(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  assert.strictEqual(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
}

// Create a temporary git repo
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gittest-'));
sh(['init'], tmp);
sh(['config', 'user.email', 't@t.com'], tmp);
sh(['config', 'user.name', 't'], tmp);
const tracked = path.join(tmp, 'tracked.cpp');
fs.writeFileSync(tracked, 'int a;');
sh(['add', 'tracked.cpp'], tmp);
sh(['commit', '--no-gpg-sign', '-m', 'init'], tmp);
const untracked = path.join(tmp, 'untracked.cpp');
fs.writeFileSync(untracked, 'int b;');

let empty;
let aliasParent;

try {
  const root = repoRoot(tracked);
  assert.ok(root && fs.existsSync(root), 'repoRoot should return a valid directory');
  assert.strictEqual(isNew(tracked, root), false, 'tracked = old file, isNew=false');
  assert.strictEqual(isNew(untracked, root), true, 'untracked = new file, isNew=true');

  // The TEMP dir on Windows CI may use an 8.3 alias such as RUNNER~1 while git rev-parse returns the long path.
  // Use a directory junction/symlink to reproduce the "same repo, different path representation" boundary reliably.
  aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), 'gitalias-'));
  const aliasRoot = path.join(aliasParent, 'repo-alias');
  fs.symlinkSync(tmp, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasTracked = path.join(aliasRoot, 'tracked.cpp');
  const canonicalRoot = repoRoot(aliasTracked);
  assert.strictEqual(isNew(aliasTracked, canonicalRoot), false,
    'a tracked file reached through a path alias should still be recognized as an old file');

  // Core regression: a first-commit file that is `git add`ed but not committed -> not in HEAD -> a new file
  const staged = path.join(tmp, 'staged.cpp');
  fs.writeFileSync(staged, 'int s;');
  sh(['add', 'staged.cpp'], tmp);
  assert.strictEqual(isNew(staged, root), true, 'added but uncommitted = new file, isNew=true');

  // Empty repo boundary: with no commits HEAD does not exist -> any file counts as new
  empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gitempty-'));
  sh(['init'], empty);
  const emptyRoot = repoRoot(path.join(empty, 'probe'));
  const ef = path.join(empty, 'e.cpp');
  fs.writeFileSync(ef, 'int e;');
  sh(['add', 'e.cpp'], empty);
  assert.strictEqual(isNew(ef, emptyRoot), true, 'in an empty repo (no commits) any file has isNew=true');

  // Not a git repo
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'nongit-'));
  const f = path.join(nonGit, 'x.cpp');
  fs.writeFileSync(f, 'int c;');
  assert.strictEqual(repoRoot(f), null, 'outside git repoRoot=null');
  assert.strictEqual(isNew(f, null), true, 'outside git every file counts as new, isNew=true');

  // changedLineRanges: one line changed in a tracked file -> the matching changed-line range is parsed
  const multi = path.join(tmp, 'multi.cpp');
  fs.writeFileSync(multi, 'int a;\nint b;\nint c;\nint d;\n');
  sh(['add', 'multi.cpp'], tmp);
  sh(['commit', '--no-gpg-sign', '-m', 'multi'], tmp);
  fs.writeFileSync(multi, 'int a;\nint b;\nint cc;\nint d;\n'); // Change line 3
  const ranges = changedLineRanges(multi, root);
  assert.ok(Array.isArray(ranges), 'changedLineRanges returns an array');
  assert.deepStrictEqual(ranges, [[3, 3]], 'only line 3 changed -> [[3,3]]');

  // An unchanged tracked file -> empty array
  assert.deepStrictEqual(changedLineRanges(tracked, root), [], 'no change -> []');

  // Not git -> null
  const nonGitR = fs.mkdtempSync(path.join(os.tmpdir(), 'nongit-cr-'));
  const nf = path.join(nonGitR, 'y.cpp');
  fs.writeFileSync(nf, 'int z;\n');
  assert.strictEqual(changedLineRanges(nf, null), null, 'not git -> null');
  fs.rmSync(nonGitR, { recursive: true, force: true });

  console.log('git.test.js PASS');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(aliasParent, { recursive: true, force: true });
  fs.rmSync(nonGit, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (aliasParent) fs.rmSync(aliasParent, { recursive: true, force: true });
  if (empty) fs.rmSync(empty, { recursive: true, force: true });
  throw e;
}
