const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, isTracked, isNew } = require('../lib/git.js');

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

// 建临时 git 仓库
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gittest-'));
sh(['init'], tmp);
sh(['config', 'user.email', 't@t.com'], tmp);
sh(['config', 'user.name', 't'], tmp);
const tracked = path.join(tmp, 'tracked.cpp');
fs.writeFileSync(tracked, 'int a;');
sh(['add', 'tracked.cpp'], tmp);
sh(['commit', '-m', 'init'], tmp);
const untracked = path.join(tmp, 'untracked.cpp');
fs.writeFileSync(untracked, 'int b;');

let empty;

try {
  const root = repoRoot(tracked);
  assert.ok(root && fs.existsSync(root), 'repoRoot 应返回有效目录');
  assert.strictEqual(isTracked(tracked, root), true, '已跟踪文件 isTracked=true');
  assert.strictEqual(isTracked(untracked, root), false, '未跟踪文件 isTracked=false');
  assert.strictEqual(isNew(tracked, root), false, '已跟踪 = 老文件 isNew=false');
  assert.strictEqual(isNew(untracked, root), true, '未跟踪 = 新文件 isNew=true');

  // 核心回归：已 git add 但未 commit 的首次提交新文件 → 不在 HEAD → 新文件
  const staged = path.join(tmp, 'staged.cpp');
  fs.writeFileSync(staged, 'int s;');
  sh(['add', 'staged.cpp'], tmp);
  assert.strictEqual(isNew(staged, root), true, '已 add 未 commit 新文件 = 新文件 isNew=true');

  // 空仓库边界：无任何 commit 时，HEAD 不存在 → 任意文件视为新文件
  empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gitempty-'));
  sh(['init'], empty);
  const emptyRoot = repoRoot(path.join(empty, 'probe'));
  const ef = path.join(empty, 'e.cpp');
  fs.writeFileSync(ef, 'int e;');
  sh(['add', 'e.cpp'], empty);
  assert.strictEqual(isNew(ef, emptyRoot), true, '空仓库(无 commit)任意文件 isNew=true');

  // 非 git 仓库
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'nongit-'));
  const f = path.join(nonGit, 'x.cpp');
  fs.writeFileSync(f, 'int c;');
  assert.strictEqual(repoRoot(f), null, '非 git repoRoot=null');
  assert.strictEqual(isNew(f, null), true, '非 git 所有文件视为新 isNew=true');

  // changedLineRanges：修改已跟踪文件后应能解析出行范围
  const { changedLineRanges } = require('../lib/git.js');
  fs.writeFileSync(tracked, 'int a;\nint a2;\nint a3;\n');
  const ranges = changedLineRanges(tracked, root);
  assert.ok(Array.isArray(ranges), 'changedLineRanges 返回数组');
  assert.ok(ranges.length > 0, '改动文件应有变更行范围');
  assert.ok(Array.isArray(ranges[0]) && ranges[0].length === 2, '范围为 [start,end] 二元组');
  // 非 git → null
  assert.strictEqual(changedLineRanges(f, null), null, '非 git changedLineRanges=null');

  console.log('git.test.js PASS');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(nonGit, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (empty) fs.rmSync(empty, { recursive: true, force: true });
  throw e;
}
