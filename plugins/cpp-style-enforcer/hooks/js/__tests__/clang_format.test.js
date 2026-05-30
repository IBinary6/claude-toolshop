const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyClangFormat } = require('../steps/clang_format.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
const created = [];
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); created.push(p); return p; }

try {
  const hasClangFormat = spawnSync('clang-format', ['--version'], { stdio: 'pipe' }).status === 0;

  if (!hasClangFormat) {
    // 降级分支：clang-format 不在 PATH → 静默返回 false，文件不动
    const f = write('a.cpp', Buffer.from('int  main( ){return 0;}', 'utf-8'));
    const before = fs.readFileSync(f);
    const changed = applyClangFormat(f);
    assert.strictEqual(changed, false, 'clang-format 缺失 → 返回 false');
    assert.ok(fs.readFileSync(f).equals(before), 'clang-format 缺失 → 文件不动');
    console.log('clang_format.test.js PASS (clang-format absent, degrade-only)');
  } else {
    // 有变化 → 写回（杂乱格式被规范化）
    const messy = write('a.cpp', Buffer.from('int  main( ){return 0;}\n', 'utf-8'));
    const changed1 = applyClangFormat(messy);
    assert.strictEqual(changed1, true, '杂乱格式 → 有变化写回');

    // 无变化 → 不写回（mtime 不变）：先格式化一次，再跑一次应无变化
    const m = fs.statSync(messy).mtimeMs;
    const changed2 = applyClangFormat(messy);
    assert.strictEqual(changed2, false, '已规范 → 无变化不写回');
    assert.strictEqual(fs.statSync(messy).mtimeMs, m, '无变化 mtime 不变');

    // 带 BOM 文件格式化后 BOM 仍是首字节
    const messyBom = write('b.cpp', Buffer.concat([BOM, Buffer.from('int  x( ){return 1;}\n', 'utf-8')]));
    applyClangFormat(messyBom);
    const out = fs.readFileSync(messyBom);
    assert.ok(out.slice(0, 3).equals(BOM), '带 BOM 格式化后 BOM 仍首字节');
    assert.ok(!out.slice(3, 6).equals(BOM), 'BOM 不重复');

    // 大文件：格式化后 stdout > Node 默认 1MB。无 maxBuffer 会 ENOBUFS 被静默跳过。
    // 这里构造缩进混乱的多行代码，格式化后正文 > 1.5MB，验证 maxBuffer(32MB) 生效、大文件能正常写回。
    const lines = [];
    lines.push('int big() {');
    for (let i = 0; i < 60000; i++) lines.push('    int  v' + i + '  =  ' + i + ' ;'); // 每行混乱空格，待规范化
    lines.push('  return 0 ;');
    lines.push('}');
    const bigSrc = Buffer.from(lines.join('\n') + '\n', 'utf-8');
    assert.ok(bigSrc.length > 1024 * 1024, '构造的输入应 > 1MB 以触发旧 1MB 上限');
    const bigFile = write('big.cpp', bigSrc);
    const changedBig = applyClangFormat(bigFile);
    assert.strictEqual(changedBig, true, '大文件杂乱格式 → 不被 ENOBUFS 静默跳过，正常写回');
    const bigOut = fs.readFileSync(bigFile);
    assert.ok(bigOut.length > 1024 * 1024, '格式化后大文件正文仍 > 1MB（确认整段被写回，未截断）');
    assert.ok(!bigOut.includes(Buffer.from('  =  ', 'utf-8')), '混乱空格已被规范化');

    console.log('clang_format.test.js PASS');
  }
} finally {
  for (const p of created) { try { fs.unlinkSync(p); } catch (_) {} }
  try { fs.rmdirSync(tmp); } catch (_) {}
}
