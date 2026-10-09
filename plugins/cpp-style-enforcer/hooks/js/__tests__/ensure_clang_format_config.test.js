const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureClangFormatConfig } = require('../lib/ensure_clang_format_config.js');

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

const tmps = [];
function mkRepo() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'clangfmt-'));
  tmps.push(t);
  sh(['init'], t);
  return t;
}

try {
  // 1. A git repo without .clang-format -> generated, with BasedOnStyle: Google, no BOM, LF
  {
    const root = mkRepo();
    ensureClangFormatConfig(root);
    const p = path.join(root, '.clang-format');
    assert.ok(fs.existsSync(p), '.clang-format should be generated');
    const buf = fs.readFileSync(p);
    assert.ok(!buf.subarray(0, 3).equals(BOM), 'the generated file should have no BOM');
    const txt = buf.toString('utf-8');
    assert.ok(/BasedOnStyle:\s*Google/.test(txt), 'the content should contain BasedOnStyle: Google');
    assert.ok(!txt.includes('\r'), 'it should use LF line endings');
  }

  // 2. An existing .clang-format (user customized) -> bytes unchanged, never overwritten
  {
    const root = mkRepo();
    const p = path.join(root, '.clang-format');
    const custom = Buffer.from('BasedOnStyle: LLVM\nIndentWidth: 8\n', 'utf-8');
    fs.writeFileSync(p, custom);
    ensureClangFormatConfig(root);
    assert.ok(fs.readFileSync(p).equals(custom), 'an existing .clang-format keeps its bytes');
  }

  // 3. An existing _clang-format (the Windows-compatible name) -> .clang-format is not generated
  {
    const root = mkRepo();
    const compat = path.join(root, '_clang-format');
    fs.writeFileSync(compat, 'BasedOnStyle: LLVM\n', 'utf-8');
    ensureClangFormatConfig(root);
    assert.ok(!fs.existsSync(path.join(root, '.clang-format')), '.clang-format is not generated when _clang-format exists');
  }

  // 4. Not a git repo (root=null) -> nothing generated, no crash
  {
    assert.doesNotThrow(() => ensureClangFormatConfig(null), 'root=null should not throw');
  }

  // 5. When a parent directory's style already applies, do not shadow it with a default style at the repo root.
  {
    const parent = mkRepo();
    const root = path.join(parent, 'nested');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(parent, '.clang-format'), 'BasedOnStyle: LLVM\nIndentWidth: 4\n');
    ensureClangFormatConfig(root);
    assert.ok(!fs.existsSync(path.join(root, '.clang-format')), 'the parent directory config inheritance is preserved');
  }

  console.log('ensure_clang_format_config.test.js PASS');
} finally {
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
}
