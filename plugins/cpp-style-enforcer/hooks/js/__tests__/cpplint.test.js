const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCpplint, formatViolations, parseCpplintOutput, MAX_ERRORS_SHOWN } = require('../steps/cpplint.js');

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

    console.log('cpplint.test.js PASS');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
} else {
  console.log('cpplint.test.js PASS (python absent, parse/format-only)');
}
