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
    // Degraded branch: clang-format is not on PATH -> silently return false and leave the file alone
    const f = write('a.cpp', Buffer.from('int  main( ){return 0;}', 'utf-8'));
    const before = fs.readFileSync(f);
    const changed = applyClangFormat(f);
    assert.strictEqual(changed, false, 'clang-format missing -> returns false');
    assert.ok(fs.readFileSync(f).equals(before), 'clang-format missing -> file untouched');
    console.log('clang_format.test.js PASS (clang-format absent, degrade-only)');
  } else {
    // A new VS file also keeps dependency-sensitive include order; even if the project asks for sorting it is not reordered.
    const vsDir = path.join(tmp, 'vs');
    fs.mkdirSync(vsDir);
    fs.writeFileSync(path.join(vsDir, 'app.vcxproj'), '<Project />');
    fs.writeFileSync(path.join(vsDir, '.clang-format'), 'BasedOnStyle: Google\nSortIncludes: CaseSensitive\nIncludeBlocks: Regroup\n');
    const vsFile = path.join(vsDir, 'main.cpp');
    fs.writeFileSync(vsFile, '#include <windows.h>\n#include <LdsLog/lds_log.h>\n\nint  f( ){return 0;}\n');
    assert.strictEqual(applyClangFormat(vsFile, { isNew: true, root: vsDir }), true);
    const vsText = fs.readFileSync(vsFile, 'utf8');
    assert.ok(vsText.indexOf('<windows.h>') < vsText.indexOf('<LdsLog/lds_log.h>'));
    fs.rmSync(vsDir, { recursive: true, force: true });

    // Changed -> written back (messy formatting is normalized)
    const messy = write('a.cpp', Buffer.from('int  main( ){return 0;}\n', 'utf-8'));
    const changed1 = applyClangFormat(messy);
    assert.strictEqual(changed1, true, 'messy formatting -> changed and written back');

    // Unchanged -> not written back (mtime stays): format once, then a second run must change nothing
    const m = fs.statSync(messy).mtimeMs;
    const changed2 = applyClangFormat(messy);
    assert.strictEqual(changed2, false, 'already normalized -> no change, nothing written');
    assert.strictEqual(fs.statSync(messy).mtimeMs, m, 'mtime unchanged when nothing changed');

    // The BOM is still the first bytes after formatting a BOM file
    const messyBom = write('b.cpp', Buffer.concat([BOM, Buffer.from('int  x( ){return 1;}\n', 'utf-8')]));
    applyClangFormat(messyBom);
    const out = fs.readFileSync(messyBom);
    assert.ok(out.slice(0, 3).equals(BOM), 'the BOM is still the first bytes after formatting a BOM file');
    assert.ok(!out.slice(3, 6).equals(BOM), 'the BOM is not duplicated');

    // Large file: formatted stdout > Node's default 1MB. Without maxBuffer it would hit ENOBUFS and be silently skipped.
    // Build many lines of badly indented code whose formatted body is > 1.5MB, and verify maxBuffer (32MB) takes effect and a large file is written back normally.
    const lines = [];
    lines.push('int big() {');
    for (let i = 0; i < 60000; i++) lines.push('    int  v' + i + '  =  ' + i + ' ;'); // Messy spacing on every line, to be normalized
    lines.push('  return 0 ;');
    lines.push('}');
    const bigSrc = Buffer.from(lines.join('\n') + '\n', 'utf-8');
    assert.ok(bigSrc.length > 1024 * 1024, 'the constructed input should be > 1MB to hit the old 1MB limit');
    const bigFile = write('big.cpp', bigSrc);
    const changedBig = applyClangFormat(bigFile);
    assert.strictEqual(changedBig, true, 'a large messy file -> not silently skipped by ENOBUFS, written back normally');
    const bigOut = fs.readFileSync(bigFile);
    assert.ok(bigOut.length > 1024 * 1024, 'the formatted large file body is still > 1MB (the whole thing was written back, not truncated)');
    assert.ok(!bigOut.includes(Buffer.from('  =  ', 'utf-8')), 'the messy spacing was normalized');

    console.log('clang_format.test.js PASS');
  }

  // ---- Old-file mode: format only changed lines + includes are never sorted ----
  if (hasClangFormat) {
    const gtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-git-'));
    function git(args) { spawnSync('git', args, { cwd: gtmp, stdio: 'pipe' }); }
    try {
      git(['init']);
      git(['config', 'user.email', 't@t.com']);
      git(['config', 'user.name', 't']);

      // The include block is deliberately out of order + an already-normalized function; commit it as HEAD (the old-file baseline)
      const baseline =
        '#include <zlib.h>\n' +
        '#include <abc.h>\n' +
        '\n' +
        'int a() { return 0; }\n' +
        'int b() { return 1; }\n';
      const f = path.join(gtmp, 'old.cpp');
      fs.writeFileSync(f, baseline);
      git(['add', 'old.cpp']);
      git(['commit', '-m', 'init']);
      const root = gtmp;

      // Change only the indentation of line 5 (function b); leave the include block (lines 1-2) alone
      const edited =
        '#include <zlib.h>\n' +
        '#include <abc.h>\n' +
        '\n' +
        'int a() { return 0; }\n' +
        'int    b()    {    return 1;    }\n';
      fs.writeFileSync(f, edited);

      const changed = applyClangFormat(f, { isNew: false, root });
      assert.strictEqual(changed, true, 'an old file with messy spacing on a changed line -> formatted and written back');
      const result = fs.readFileSync(f, 'utf-8').split('\n');
      // Include order stays as it was (sorting is off)
      assert.strictEqual(result[0], '#include <zlib.h>', 'old file include line 1 unchanged (not sorted)');
      assert.strictEqual(result[1], '#include <abc.h>', 'old file include line 2 unchanged (not sorted)');
      // Line 4 (the untouched function a) stays as it was
      assert.strictEqual(result[3], 'int a() { return 0; }', 'unchanged lines of an old file are not formatted');
      // Line 5 (the changed function b) is normalized
      assert.strictEqual(result[4], 'int b() { return 1; }', 'changed lines of an old file are normalized');

      // The include block itself changes -> still not sorted (sorting stays off)
      const baseline2 = '#include <zlib.h>\n#include <abc.h>\nint a() { return 0; }\n';
      const f2 = path.join(gtmp, 'inc.cpp');
      fs.writeFileSync(f2, baseline2);
      git(['add', 'inc.cpp']);
      git(['commit', '-m', 'inc']);
      // Change the spacing of the include on line 1 (so the change lands in the include block)
      const edited2 = '#include    <zlib.h>\n#include <abc.h>\nint a() { return 0; }\n';
      fs.writeFileSync(f2, edited2);
      applyClangFormat(f2, { isNew: false, root });
      const r2 = fs.readFileSync(f2, 'utf-8').split('\n');
      assert.strictEqual(r2[0], '#include <zlib.h>', 'a change inside the include block is not sorted either: line 1 is still zlib');
      assert.strictEqual(r2[1], '#include <abc.h>', 'a change inside the include block is not sorted either: line 2 is still abc');

      // No changed lines -> do not format, return false
      const f3 = path.join(gtmp, 'nochange.cpp');
      fs.writeFileSync(f3, 'int  m( ){return 0;}\n'); // Messy but identical to HEAD
      git(['add', 'nochange.cpp']);
      git(['commit', '-m', 'nochange']);
      const beforeNc = fs.readFileSync(f3);
      const changedNc = applyClangFormat(f3, { isNew: false, root });
      assert.strictEqual(changedNc, false, 'an old file with no changed lines -> not formatted, returns false');
      assert.ok(fs.readFileSync(f3).equals(beforeNc), 'an old file with no changed lines -> content untouched');

      // An old file must not be overridden by an inline Google style; it has to use the project's four-space indent.
      fs.writeFileSync(path.join(gtmp, '.clang-format'),
        'BasedOnStyle: LLVM\nIndentWidth: 4\nAllowShortFunctionsOnASingleLine: None\n');
      const configured = path.join(gtmp, 'configured.cpp');
      fs.writeFileSync(configured, 'int configured() {\n    return 1;\n}\n');
      git(['add', 'configured.cpp']);
      git(['commit', '-m', 'configured']);
      fs.writeFileSync(configured, 'int configured() {\n return    2;\n}\n');
      assert.strictEqual(applyClangFormat(configured, { isNew: false, root }), true);
      assert.strictEqual(fs.readFileSync(configured, 'utf8'), 'int configured() {\n    return 2;\n}\n');

      console.log('clang_format.test.js old-file mode PASS');
    } finally {
      fs.rmSync(gtmp, { recursive: true, force: true });
    }
  }
} finally {
  for (const p of created) { try { fs.unlinkSync(p); } catch (_) {} }
  try { fs.rmdirSync(tmp); } catch (_) {}
}
