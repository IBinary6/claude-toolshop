const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCpplint, formatViolations, parseCpplintOutput, buildFilterArg, MAX_ERRORS_SHOWN } = require('../steps/cpplint.js');
const { resolvePython } = require('../lib/python');

// ---- formatViolations: deduplicate verbatim, keep the first 5 plus an "N more" line ----
const many = [];
for (let i = 1; i <= 8; i++) many.push({ line: i, category: 'whitespace/indent', message: `msg ${i}` });
many.push({ line: 1, category: 'whitespace/indent', message: 'msg 1' }); // Identical to the first entry -> deduplicated
const reason = formatViolations(many);
assert.ok(reason.includes('msg 1') && reason.includes('msg 5'), 'keeps the first 5 entries');
assert.ok(!reason.includes('msg 6'), 'the 6th entry is not among the first 5');
assert.ok(/3 more violation/.test(reason), 'after dedup there are 8 entries, 5 are shown and 3 are left');
assert.strictEqual(MAX_ERRORS_SHOWN, 5, 'MAX_ERRORS_SHOWN=5');
assert.ok(/please fix/.test(reason), 'formatViolations asks Claude to fix them (hard violations)');

// Identical entries -> deduplicated to 1, no "more" line
const dup = [
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
  { line: 2, category: 'build/include', message: 'same' },
];
const r2 = formatViolations(dup);
assert.ok(r2.includes('same'), 'keeps 1 entry');
assert.ok(!/more violation/.test(r2), 'a single entry after dedup shows no "more" hint');

const multiFile = formatViolations([
  { file: 'src/a.cpp', line: 3, category: 'whitespace/braces', message: 'bad' },
  { file: 'src/b.cpp', line: 3, category: 'whitespace/braces', message: 'bad' },
]);
assert.ok(multiFile.includes('src/a.cpp:3'), 'multi-file output should include file a');
assert.ok(multiFile.includes('src/b.cpp:3'), 'multi-file output should include file b');

// ---- soft-violation exports were removed: splitViolations/formatSoftViolations/SOFT_CATEGORIES are no longer exported ----
const cpplintMod = require('../steps/cpplint.js');
assert.strictEqual(cpplintMod.splitViolations, undefined, 'splitViolations was removed');
assert.strictEqual(cpplintMod.formatSoftViolations, undefined, 'formatSoftViolations was removed');
assert.strictEqual(cpplintMod.SOFT_CATEGORIES, undefined, 'SOFT_CATEGORIES was removed');

// ---- parseCpplintOutput: parse line/category/message ----
const sample = [
  '/tmp/x.cpp:0:  No copyright message found.  [legal/copyright] [5]',
  '/tmp/x.cpp:12:  Missing space before {  [whitespace/braces] [5]',
].join('\n');
const parsed = parseCpplintOutput(sample);
assert.strictEqual(parsed.length, 2, 'parses 2 entries');
assert.strictEqual(parsed[1].line, 12, 'line is parsed');
assert.strictEqual(parsed[1].category, 'whitespace/braces', 'category is parsed');
assert.ok(/Missing space/.test(parsed[1].message), 'message is parsed');

// ---- buildFilterArg: the default filters always suppress namespace-indent noise and copyright checks ----
assert.strictEqual(
  buildFilterArg({}),
  '--filter=-whitespace/indent_namespace,-legal/copyright',
  'defaults suppress namespace-indent false positives and legal/copyright (headers are not managed)',
);
assert.strictEqual(
  buildFilterArg({ extraFilters: ['-readability/casting', '-legal/copyright'] }),
  '--filter=-whitespace/indent_namespace,-legal/copyright,-readability/casting',
  'extra filters are appended and duplicates removed',
);
assert.ok(buildFilterArg({ preserveIncludeOrder: true }).includes('-build/include_order'));
assert.ok(!buildFilterArg({}).includes('-build/include_order'));

// A runtime failure must not pose as zero violations, and must not depend on the local Python or Git.
assert.ok(runCpplint(__filename, { resolvePython: () => null })
  .some((item) => item.category === 'runtime/cpplint'));
for (const result of [
  { status: 7, stderr: Buffer.from('Traceback: linter failed') },
  { status: null, signal: 'SIGTERM' },
  { error: { code: 'ENOENT' } },
  { status: 0, stderr: Buffer.from('Line length must be numeric.') },
]) {
  const violations = runCpplint(__filename, {
    resolvePython: () => ({ cmd: 'test-python', args: [] }),
    spawnSync: () => result,
  });
  assert.ok(violations.some((item) => item.category === 'runtime/cpplint'));
}

// ---- runCpplint: no false positives under the real file name + the original file is untouched (needs python) ----
const hasPython = resolvePython() !== null;
if (hasPython) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplint-'));
  try {
    // Build a real project layout (not a hashed temp name), root=tmp
    const src = path.join(tmp, 'proj', 'src');
    fs.mkdirSync(src, { recursive: true });

    // 1) A simple cpp file must stay byte-identical
    const f = path.join(src, 'main.cpp');
    const content = Buffer.from('int main() { return 0; }\n', 'utf-8');
    fs.writeFileSync(f, content);
    const before = fs.readFileSync(f);
    const viol = runCpplint(f, { root: tmp });
    assert.ok(Array.isArray(viol), 'runCpplint returns an array');
    assert.ok(fs.readFileSync(f).equals(before), 'the cpplint step leaves the original file byte-identical (no BOM, nothing written)');

    // 1b) CRLF is a project/platform line-ending policy; cpplint must neither flag nor rewrite it
    const crlfCpp = path.join(src, 'crlf.cpp');
    const crlfBytes = Buffer.from('int crlf() {\r\n  return 0;\r\n}\r\n', 'utf-8');
    fs.writeFileSync(crlfCpp, crlfBytes);
    const vCrlf = runCpplint(crlfCpp, { root: tmp });
    assert.ok(
      !vCrlf.some((v) => v.category === 'whitespace/newline' || v.category === 'whitespace/ending_newline'),
      'a CRLF file must not trigger newline-class cpplint false positives',
    );
    assert.ok(fs.readFileSync(crlfCpp).equals(crlfBytes), 'a CRLF file keeps its original bytes after linting');

    // 2) A correct header guard under the real file name should PASS (no header_guard false positive)
    //    --root=tmp -> RepositoryName=proj/src/foo.h -> expected macro PROJ_SRC_FOO_H_
    const fooH = path.join(src, 'foo.h');
    const guardOk = '#ifndef PROJ_SRC_FOO_H_\n#define PROJ_SRC_FOO_H_\n\nclass Foo {};\n\n#endif  // PROJ_SRC_FOO_H_\n';
    fs.writeFileSync(fooH, Buffer.from(guardOk, 'utf-8'));
    const vGuardOk = runCpplint(fooH, { root: tmp });
    assert.ok(
      !vGuardOk.some((v) => v.category === 'build/header_guard'),
      'a correct guard under the real path is not a header_guard false positive',
    );

    // 3) A wrong guard name (inconsistent with the real path) -> header_guard is still reported (real violations are reported)
    const badH = path.join(src, 'bar.h');
    fs.writeFileSync(badH, Buffer.from('class Bar {};\n', 'utf-8'));
    const vBad = runCpplint(badH, { root: tmp });
    assert.ok(
      vBad.some((v) => v.category === 'build/header_guard'),
      'a header without a guard still reports header_guard (a real violation)',
    );

    // 4) A header with a BOM and a correct guard -> no header_guard false positive, and the original BOM is restored
    const bomH = path.join(src, 'baz.h');
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    const bazGuard = '#ifndef PROJ_SRC_BAZ_H_\r\n#define PROJ_SRC_BAZ_H_\r\n\r\nclass Baz {};\r\n\r\n#endif  // PROJ_SRC_BAZ_H_\r\n';
    const bomBytes = Buffer.concat([BOM, Buffer.from(bazGuard, 'utf-8')]);
    fs.writeFileSync(bomH, bomBytes);
    fs.utimesSync(bomH, new Date(1000000), new Date(1000000));
    const bomMtime = fs.statSync(bomH).mtimeMs;
    const vBom = runCpplint(bomH, { root: tmp });
    assert.ok(
      !vBom.some((v) => v.category === 'build/header_guard'),
      'a BOM header is not a header_guard false positive once the BOM is stripped',
    );
    assert.ok(fs.readFileSync(bomH).equals(bomBytes), 'a BOM + CRLF file keeps its original bytes (BOM and CRLF) after linting');
    assert.strictEqual(fs.statSync(bomH).mtimeMs, bomMtime, 'the file must not be written even temporarily while linting a BOM file');

    // 5) A file without a copyright header is never reported for it
    const fc = path.join(src, 'nocopy.cpp');
    fs.writeFileSync(fc, Buffer.from('int main() { return 0; }\n', 'utf-8'));
    const vc = runCpplint(fc, { root: tmp });
    assert.ok(!vc.some((v) => v.category === 'legal/copyright'), 'legal/copyright is always suppressed');

    console.log('cpplint.test.js PASS');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
} else {
  console.log('cpplint.test.js PASS (python absent, parse/format-only)');
}
