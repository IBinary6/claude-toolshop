const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyBom } = require('../steps/bom.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bomstep-'));
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; }

try {
  // UTF-8 without a BOM -> add a BOM
  const f1 = write('a.cpp', Buffer.from('int a;', 'utf-8'));
  applyBom(f1, { isCMake: false });
  let b1 = fs.readFileSync(f1);
  assert.ok(b1.slice(0, 3).equals(BOM), 'UTF-8 without a BOM -> BOM added');

  // Already has a BOM -> not written again (mtime unchanged)
  const f2 = write('b.cpp', Buffer.concat([BOM, Buffer.from('int b;', 'utf-8')]));
  const m2 = fs.statSync(f2).mtimeMs;
  const before2 = fs.readFileSync(f2);
  applyBom(f2, { isCMake: false });
  assert.ok(fs.readFileSync(f2).equals(before2), 'an existing BOM leaves the content unchanged');
  assert.strictEqual(fs.statSync(f2).mtimeMs, m2, 'an existing BOM is not rewritten, so mtime is unchanged');

  // CMake projects must get a BOM too
  const f3 = write('c.cpp', Buffer.from('int c;', 'utf-8'));
  applyBom(f3, { isCMake: true });
  assert.ok(fs.readFileSync(f3).slice(0, 3).equals(BOM), 'CMake projects get a BOM too');

  // Empty file -> write only the BOM
  const f4 = write('d.cpp', Buffer.alloc(0));
  applyBom(f4, { isCMake: false });
  const b4 = fs.readFileSync(f4);
  assert.ok(b4.equals(BOM), 'an empty file gets only a BOM');

  // UTF-16 -> skipped (left alone)
  const utf16 = Buffer.from([0xFF, 0xFE, 0x41, 0x00]);
  const f5 = write('e.cpp', utf16);
  applyBom(f5, { isCMake: false });
  assert.ok(fs.readFileSync(f5).equals(utf16), 'UTF-16 is skipped and left alone');

  // GBK -> transcoded and given a BOM when iconv is available; when iconv is missing it degrades to unknown -> left alone (avoids a broken file)
  let iconvAvailable = false;
  try { require('iconv-lite'); iconvAvailable = true; } catch (_) {}
  const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]); // GBK bytes of a two-character greeting
  const f6 = write('f.cpp', gbk);
  const ret6 = applyBom(f6, { isCMake: false });
  const b6 = fs.readFileSync(f6);
  if (iconvAvailable) {
    assert.ok(b6.slice(0, 3).equals(BOM), 'GBK -> BOM added');
    const iconv = require('iconv-lite');
    assert.strictEqual(b6.slice(3).toString('utf-8'), iconv.decode(gbk, 'gbk'), 'GBK -> transcoded to UTF-8');
  } else {
    // iconv missing -> detectEncoding degrades the GBK bytes to unknown -> no BOM added, left as-is
    // (the old behaviour of prepending a UTF-8 BOM would produce a broken EF BB BF + GBK file and damage a GBK file that opened fine)
    assert.strictEqual(ret6, false, 'iconv missing -> GBK degrades to unknown -> return false');
    assert.ok(b6.equals(gbk), 'iconv missing -> the GBK file bytes are unchanged (no BOM added)');
  }

  // unknown encoding -> no BOM added, left as-is (bytes unchanged, return false)
  // Build a byte sequence that is neither valid UTF-8 nor identifiable as GBK when iconv is missing
  const raw = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x80, 0x81]);
  const f7 = write('g.cpp', raw);
  const ret7 = applyBom(f7, { isCMake: false });
  const b7 = fs.readFileSync(f7);
  if (!iconvAvailable) {
    // iconv missing -> detectEncoding necessarily returns unknown
    assert.strictEqual(ret7, false, 'unknown encoding -> return false');
    assert.ok(b7.equals(raw), 'unknown encoding -> bytes unchanged (no BOM added)');
  }

  console.log('bom.test.js PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
