const assert = require('node:assert');
const { stripBom, restoreBom, detectEncoding } = require('../lib/bom_util.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const body = Buffer.from('int main(){}', 'utf-8');

// 往返：带 BOM
const withBom = Buffer.concat([BOM, body]);
let s = stripBom(withBom);
assert.strictEqual(s.hadBom, true, '应检出 BOM');
assert.ok(s.body.equals(body), 'body 应去掉 BOM');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), '往返字节级一致(带BOM)');

// 往返：不带 BOM
s = stripBom(body);
assert.strictEqual(s.hadBom, false, '无 BOM');
assert.ok(restoreBom(s.hadBom, s.body).equals(body), '往返字节级一致(无BOM)');

// 多前导 BOM 归一为一个
const triple = Buffer.concat([BOM, BOM, BOM, body]);
s = stripBom(triple);
assert.strictEqual(s.hadBom, true, '多 BOM 仍 hadBom=true');
assert.ok(s.body.equals(body), '多 BOM 全部剥掉');
assert.ok(restoreBom(s.hadBom, s.body).equals(withBom), '多 BOM 归一为恰好一个');

// detectEncoding 分类
assert.strictEqual(detectEncoding(withBom), 'utf-8-bom', 'UTF-8 BOM');
assert.strictEqual(detectEncoding(body), 'utf-8', '无 BOM UTF-8');
assert.strictEqual(detectEncoding(Buffer.from([0xFF, 0xFE, 0x41, 0x00])), 'utf-16', 'UTF-16 LE');
assert.strictEqual(detectEncoding(Buffer.from([0xFE, 0xFF, 0x00, 0x41])), 'utf-16', 'UTF-16 BE');
// GBK：含高位字节但非合法 UTF-8（0xC4 0xE3 = "你" 的 GBK，但单独 0xD0 0xE3 等）
const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]); // "你好" GBK
// spec §9：iconv-lite 缺失 → GBK 检测降级为 'unknown'（被 try/catch 吞）。
// 故此断言容忍 'gbk'（iconv-lite 可用）或 'unknown'（iconv-lite 缺失）。
let hasIconv = false;
try { require('iconv-lite'); hasIconv = true; } catch (_) {}
const gbkResult = detectEncoding(gbk);
if (hasIconv) {
  assert.strictEqual(gbkResult, 'gbk', 'GBK 分类（iconv-lite 可用）');
} else {
  assert.strictEqual(gbkResult, 'unknown', 'GBK 降级 unknown（iconv-lite 缺失）');
}
console.log('bom_util.test.js PASS');
