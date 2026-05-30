const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyBom } = require('../steps/bom.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bomstep-'));
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; }

try {
  // UTF-8 无 BOM → 补 BOM
  const f1 = write('a.cpp', Buffer.from('int a;', 'utf-8'));
  applyBom(f1, { isCMake: false });
  let b1 = fs.readFileSync(f1);
  assert.ok(b1.slice(0, 3).equals(BOM), 'UTF-8 无 BOM → 补 BOM');

  // 已有 BOM → 不重复写（mtime 不变）
  const f2 = write('b.cpp', Buffer.concat([BOM, Buffer.from('int b;', 'utf-8')]));
  const m2 = fs.statSync(f2).mtimeMs;
  const before2 = fs.readFileSync(f2);
  applyBom(f2, { isCMake: false });
  assert.ok(fs.readFileSync(f2).equals(before2), '已有 BOM 内容不变');
  assert.strictEqual(fs.statSync(f2).mtimeMs, m2, '已有 BOM 不写 mtime 不变');

  // CMake 项目 → 跳过（无 BOM 仍无 BOM）
  const f3 = write('c.cpp', Buffer.from('int c;', 'utf-8'));
  applyBom(f3, { isCMake: true });
  assert.ok(!fs.readFileSync(f3).slice(0, 3).equals(BOM), 'CMake 项目跳过 BOM');

  // 空文件 → 只写 BOM
  const f4 = write('d.cpp', Buffer.alloc(0));
  applyBom(f4, { isCMake: false });
  const b4 = fs.readFileSync(f4);
  assert.ok(b4.equals(BOM), '空文件只写 BOM');

  // UTF-16 → 跳过（不动）
  const utf16 = Buffer.from([0xFF, 0xFE, 0x41, 0x00]);
  const f5 = write('e.cpp', utf16);
  applyBom(f5, { isCMake: false });
  assert.ok(fs.readFileSync(f5).equals(utf16), 'UTF-16 跳过不动');

  // GBK → 转码加 BOM（iconv-lite 可用时严格断言，缺失时容忍 spec §9）
  let iconvAvailable = false;
  try { require('iconv-lite'); iconvAvailable = true; } catch (_) {}
  const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]); // "你好" GBK
  const f6 = write('f.cpp', gbk);
  applyBom(f6, { isCMake: false });
  const b6 = fs.readFileSync(f6);
  if (iconvAvailable) {
    assert.ok(b6.slice(0, 3).equals(BOM), 'GBK → 加 BOM');
    const iconv = require('iconv-lite');
    assert.strictEqual(b6.slice(3).toString('utf-8'), iconv.decode(gbk, 'gbk'), 'GBK → 转码为 UTF-8');
  } else {
    // spec §9：iconv 缺失 → detectEncoding 把 GBK 字节降级为 unknown → 实现补 BOM（前置 BOM，原字节保留）
    assert.ok(b6.equals(Buffer.concat([BOM, gbk])), 'iconv 缺失 → GBK 降级 unknown → 补 BOM (spec §9)');
  }

  console.log('bom.test.js PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
