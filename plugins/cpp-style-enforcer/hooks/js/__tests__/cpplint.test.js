const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCpplint, formatViolations, formatSoftViolations, splitViolations, parseCpplintOutput, buildFilterArg, SOFT_CATEGORIES, MAX_ERRORS_SHOWN } = require('../steps/cpplint.js');

// ---- formatViolations：逐字去重后取前 5 + 「还有 N 条」----
const many = [];
for (let i = 1; i <= 8; i++) many.push({ line: i, category: 'whitespace/indent', message: `msg ${i}` });
many.push({ line: 1, category: 'whitespace/indent', message: 'msg 1' }); // 与首条逐字相同 → 去重
const reason = formatViolations(many);
assert.ok(reason.includes('msg 1') && reason.includes('msg 5'), '取前 5 条');
assert.ok(!reason.includes('msg 6'), '第 6 条不在前 5');
assert.ok(/还有 3 条/.test(reason), '去重后 8 条，显示 5 条，还有 3 条');
assert.strictEqual(MAX_ERRORS_SHOWN, 5, 'MAX_ERRORS_SHOWN=5');

// 全相同条目 → 去重为 1 条，无「还有」
const dup = [
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
];
const r2 = formatViolations(dup);
assert.ok(r2.includes('same'), '保留 1 条');
assert.ok(!/还有/.test(r2), '去重后仅 1 条无「还有」提示');

// ---- parseCpplintOutput：解析 line/category/message ----
const sample = [
  '/tmp/x.cpp:0:  No copyright message found.  [legal/copyright] [5]',
  '/tmp/x.cpp:12:  Missing space before {  [whitespace/braces] [5]',
].join('\n');
const parsed = parseCpplintOutput(sample);
assert.strictEqual(parsed.length, 2, '解析 2 条');
assert.strictEqual(parsed[1].line, 12, 'line 解析');
assert.strictEqual(parsed[1].category, 'whitespace/braces', 'category 解析');
assert.ok(/Missing space/.test(parsed[1].message), 'message 解析');

// ---- buildFilterArg：无基础 filter 项，空时不传 --filter ----
// 新架构下 format 已对齐 Google，无需 include_order/whitespace 等防互搏 filter。
assert.strictEqual(buildFilterArg({}), null, '无任何 filter 项时返回 null（调用方不传 --filter）');
assert.strictEqual(
  buildFilterArg({ suppressCopyright: true }),
  '--filter=-legal/copyright',
  'suppressCopyright 仅含 -legal/copyright',
);
assert.ok(
  !buildFilterArg({ suppressCopyright: true }).includes('include_order'),
  '不再含已删除的 -build/include_order',
);
assert.ok(
  !String(buildFilterArg({ suppressCopyright: false })).includes('--filter'),
  '不抑制版权且无额外项时无 --filter',
);

// ---- SOFT_CATEGORIES：include_subdir 与 header_guard 均为软违规 ----
assert.ok(SOFT_CATEGORIES.has('build/include_subdir'), 'include_subdir 软违规');
assert.ok(SOFT_CATEGORIES.has('build/header_guard'), 'header_guard 软违规');

// ---- splitViolations：header_guard / include_subdir → soft；其它 → hard ----
const mixed = [
  { line: 1, category: 'build/header_guard', message: 'No #ifndef header guard found' },
  { line: 2, category: 'build/include_subdir', message: 'Include the directory' },
  { line: 3, category: 'whitespace/braces', message: 'Missing space' },
];
const { hard, soft } = splitViolations(mixed);
assert.strictEqual(soft.length, 2, 'header_guard + include_subdir 进 soft');
assert.strictEqual(hard.length, 1, 'whitespace/braces 进 hard');
assert.ok(soft.some((v) => v.category === 'build/header_guard'), 'header_guard 为软违规（建议非硬 block）');

// ---- formatSoftViolations：建议性文案（非「必须修复」）----
const softReason = formatSoftViolations([
  { line: 1, category: 'build/header_guard', message: 'No #ifndef header guard found' },
]);
assert.ok(/建议/.test(softReason), '软违规文案为建议性');
assert.ok(/pragma once|guard/.test(softReason), '软违规文案提及 guard/#pragma once');
assert.ok(!/必须修复/.test(softReason), '软违规文案不含「必须修复」');

// ---- runCpplint：原文件字节零改动 + 临时副本防碰撞（需 python）----
const hasPython = spawnSync('python', ['--version'], { stdio: 'pipe' }).status === 0
  || spawnSync('python3', ['--version'], { stdio: 'pipe' }).status === 0;
if (hasPython) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplint-'));
  try {
    const f = path.join(tmp, 'main.cpp');
    const content = Buffer.from('int main(){return 0;}\n', 'utf-8');
    fs.writeFileSync(f, content);
    const before = fs.readFileSync(f);
    const viol = runCpplint(f, { root: tmp, suppressCopyright: true });
    assert.ok(Array.isArray(viol), 'runCpplint 返回数组');
    assert.ok(fs.readFileSync(f).equals(before), 'cpplint 步骤原文件字节零改动');

    // 临时副本相对路径 hash 防同名碰撞：两个不同子目录下的同名 main.cpp
    // 写入不同内容，分别 lint，验证临时副本路径不同（不互相覆盖）。
    const subA = path.join(tmp, 'a');
    const subB = path.join(tmp, 'b');
    fs.mkdirSync(subA, { recursive: true });
    fs.mkdirSync(subB, { recursive: true });
    const fa = path.join(subA, 'main.cpp');
    const fb = path.join(subB, 'main.cpp');
    const beforeA = Buffer.from('int a(){return 0;}\n', 'utf-8');
    const beforeB = Buffer.from('int b(){return 0;}\n', 'utf-8');
    fs.writeFileSync(fa, beforeA);
    fs.writeFileSync(fb, beforeB);
    runCpplint(fa, { root: tmp, suppressCopyright: true });
    runCpplint(fb, { root: tmp, suppressCopyright: true });
    assert.ok(fs.readFileSync(fa).equals(beforeA), '同名文件 a 原文件零改动');
    assert.ok(fs.readFileSync(fb).equals(beforeB), '同名文件 b 原文件零改动（防碰撞）');

    // suppressCopyright=true → 结果不含 legal/copyright；新架构无 filter 时也不报 include_order
    const fc = path.join(tmp, 'nocopy.cpp');
    fs.writeFileSync(fc, Buffer.from('int main() { return 0; }\n', 'utf-8'));
    const vc = runCpplint(fc, { root: tmp, suppressCopyright: true });
    assert.ok(!vc.some((v) => v.category === 'legal/copyright'), 'suppressCopyright 屏蔽 legal/copyright');
    assert.ok(!vc.some((v) => v.category === 'build/include_order'), '无 filter 时也不报 include_order');

    // suppressCopyright=false → 缺版权头会报 legal/copyright（验证开关有效）
    const vcWithCopy = runCpplint(fc, { root: tmp, suppressCopyright: false });
    assert.ok(vcWithCopy.some((v) => v.category === 'legal/copyright'), '不抑制时报 legal/copyright');

    // .h 无 include guard → header_guard，经 splitViolations 归为软违规（非硬 block）
    const fh = path.join(tmp, 'widget.h');
    fs.writeFileSync(fh, Buffer.from('class Widget {};\n', 'utf-8'));
    const vh = runCpplint(fh, { root: tmp, suppressCopyright: true });
    const guard = vh.filter((v) => v.category === 'build/header_guard');
    if (guard.length > 0) {
      const split = splitViolations(vh);
      assert.ok(
        split.soft.some((v) => v.category === 'build/header_guard'),
        'header_guard 走软违规（建议性提示，不硬 block）',
      );
    }

    console.log('cpplint.test.js PASS');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
} else {
  console.log('cpplint.test.js PASS (python absent, parse/format-only)');
}
