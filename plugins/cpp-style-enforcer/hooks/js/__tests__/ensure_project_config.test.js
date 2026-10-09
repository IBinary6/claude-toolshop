const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureProjectConfig } = require('../lib/ensure_project_config.js');
const { DEFAULT_CONFIG } = require('../lib/config.js');

function sh(args, cwd) { spawnSync('git', args, { cwd, stdio: 'pipe' }); }

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmps = [];
function mkRepo() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'projcfg-'));
  tmps.push(t);
  sh(['init'], t);
  return t;
}
function relPath(root) { return path.join(root, '.claude-cpp-style', 'cpp-style.json'); }

try {
  // 1. No .claude-cpp-style + a global template -> generated, content from the global template, no BOM
  {
    const root = mkRepo();
    const tplDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
    tmps.push(tplDir);
    const tpl = path.join(tplDir, 'cpp-style-template.json');
    const tplContent = JSON.stringify({ enabled: true, mode: 'full', checks: { clangFormat: true } }, null, 2) + '\n';
    fs.writeFileSync(tpl, Buffer.from(tplContent, 'utf-8'));

    ensureProjectConfig(root, tpl);
    const p = relPath(root);
    assert.ok(fs.existsSync(p), 'cpp-style.json should be generated');
    const buf = fs.readFileSync(p);
    assert.ok(!buf.subarray(0, 3).equals(BOM), 'the generated file has no BOM');
    assert.strictEqual(buf.toString('utf-8'), tplContent, 'content comes from the global template (verbatim)');
    const parsed = JSON.parse(buf.toString('utf-8'));
    assert.strictEqual(parsed.mode, 'full', 'template fields are preserved');
  }

  // 2. The global template is missing -> use the hard-coded default schema
  {
    const root = mkRepo();
    const missing = path.join(os.tmpdir(), 'nonexistent-tpl-xyz.json');
    ensureProjectConfig(root, missing);
    const p = relPath(root);
    assert.ok(fs.existsSync(p), 'generated even when the template is missing');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    assert.deepStrictEqual(parsed, DEFAULT_CONFIG, 'content is the hard-coded default schema');
  }

  // 3. The global template is corrupt (invalid JSON) -> fall back to the default schema
  {
    const root = mkRepo();
    const tplDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplbad-'));
    tmps.push(tplDir);
    const tpl = path.join(tplDir, 'bad.json');
    fs.writeFileSync(tpl, '{ not valid json', 'utf-8');
    ensureProjectConfig(root, tpl);
    const parsed = JSON.parse(fs.readFileSync(relPath(root), 'utf-8'));
    assert.deepStrictEqual(parsed, DEFAULT_CONFIG, 'a corrupt template falls back to the default schema');
  }

  // 4. An existing cpp-style.json -> bytes unchanged, never overwritten
  {
    const root = mkRepo();
    const dir = path.join(root, '.claude-cpp-style');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'cpp-style.json');
    const custom = Buffer.from('{"enabled":false,"mode":"full"}\n', 'utf-8');
    fs.writeFileSync(p, custom);
    ensureProjectConfig(root); // Use the default template path; it must not trigger a write
    assert.ok(fs.readFileSync(p).equals(custom), 'an existing file keeps its bytes and is not overwritten');
  }

  // 5. Not a git repo (root=null) -> nothing generated, no crash
  {
    assert.doesNotThrow(() => ensureProjectConfig(null), 'root=null should not throw');
  }

  console.log('ensure_project_config.test.js PASS');
} finally {
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
}
