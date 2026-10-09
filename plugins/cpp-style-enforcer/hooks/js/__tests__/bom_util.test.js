const assert = require('node:assert');
const { stripBom, restoreBom, detectEncoding } = require('../lib/bom_util.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from('int main(){}', 'utf-8');

// Round trip: with a BOM
const withBom = Buffer.concat([BOM, body]);
let s = stripBom(withBom);
assert.strictEqual(s.hadBom, true, 'the BOM should be detected');
assert.ok(s.body.equals(body), 'body should have the BOM removed');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), 'round trip is byte-identical (with BOM)');

// Round trip: without a BOM
s = stripBom(body);
assert.strictEqual(s.hadBom, false, 'no BOM');
assert.ok(restoreBom(s.hadBom, s.body).equals(body), 'round trip is byte-identical (no BOM)');

// Several leading BOMs normalize to one
const triple = Buffer.concat([BOM, BOM, BOM, body]);
s = stripBom(triple);
assert.strictEqual(s.hadBom, true, 'multiple BOMs still give hadBom=true');
assert.ok(s.body.equals(body), 'all the BOMs are stripped');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), 'multiple BOMs normalize to exactly one');

// detectEncoding classification
assert.strictEqual(detectEncoding(withBom), 'utf-8-bom', 'UTF-8 BOM');
assert.strictEqual(detectEncoding(body), 'utf-8', 'UTF-8 without a BOM');
assert.strictEqual(detectEncoding(Buffer.from([0xFF, 0xFE, 0x41, 0x00])), 'utf-16', 'UTF-16 LE');
assert.strictEqual(detectEncoding(Buffer.from([0xFE, 0xFF, 0x00, 0x41])), 'utf-16', 'UTF-16 BE');
// GBK: contains high bytes but is not valid UTF-8 (the bytes below are a two-character GBK-encoded greeting)
const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]); // GBK bytes of a two-character greeting
// spec §9: iconv-lite missing -> GBK detection degrades to 'unknown' (swallowed by try/catch).
// So this assertion accepts 'gbk' (iconv-lite available) or 'unknown' (iconv-lite missing).
let hasIconv = false;
try { require('iconv-lite'); hasIconv = true; } catch (_) {}
const gbkResult = detectEncoding(gbk);
if (hasIconv) {
  assert.strictEqual(gbkResult, 'gbk', 'GBK classification (iconv-lite available)');
} else {
  assert.strictEqual(gbkResult, 'unknown', 'GBK degrades to unknown (iconv-lite missing)');
}
// Edge: an empty buffer must not crash
const empty = Buffer.from([]);
s = stripBom(empty);
assert.strictEqual(s.hadBom, false, 'an empty buffer has no BOM');
assert.strictEqual(s.body.length, 0, 'an empty buffer body has length 0');
assert.strictEqual(detectEncoding(empty), 'utf-8', 'detectEncoding does not crash on an empty buffer');

// Edge: all BOM and no body (body length 0)
const onlyBom = Buffer.concat([BOM, BOM]);
s = stripBom(onlyBom);
assert.strictEqual(s.hadBom, true, 'all BOM -> hadBom=true');
assert.strictEqual(s.body.length, 0, 'all BOM -> body length 0');
assert.ok(restoreBom(s.hadBom, s.body).equals(BOM), 'all BOM round trips to a single BOM');

// Slice isolation regression: mutate the original buf, the body content must not change (verifies an independent copy)
const mutSrc = Buffer.concat([BOM, body]);
const r = stripBom(mutSrc);
const bodySnapshot = Buffer.from(r.body); // Snapshot of the current body content
mutSrc[3] = mutSrc[3] ^ 0xFF; // Tamper with the first body byte of the original buf
assert.ok(r.body.equals(bodySnapshot), 'body does not change when the original buf changes (independent memory)');

// Slice isolation regression: the no-BOM branch must be independent too
const mutSrc2 = Buffer.from(body);
const r2 = stripBom(mutSrc2);
const bodySnapshot2 = Buffer.from(r2.body);
mutSrc2[0] = mutSrc2[0] ^ 0xFF;
assert.ok(r2.body.equals(bodySnapshot2), 'the no-BOM branch body is independent too');

console.log('bom_util.test.js PASS');
