const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, ensureUserTemplate, DEFAULT_CONFIG } = require('../lib/config.js');

// Isolation: every ensureUserTemplate/loadConfig call in this test passes explicit temporary paths,
// and never relies on the os.homedir() default, so the real ~/.claude/cpp-style-template.json is never read or written.
// A cleanup collector also gathers all temporary directories and removes them in finally.
const cleanupDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(d);
  return d;
}

try {
  // ---- ensureUserTemplate: an existing template is never overwritten (byte-identical before and after, including user-filled fields) ----
  const tmpl = mkTmp('tmpl-');
  const defaultPath = path.join(tmpl, 'cpp-style-template.default.json');
  fs.writeFileSync(defaultPath, JSON.stringify(DEFAULT_CONFIG));
  const userPath = path.join(tmpl, 'user-template.json');
  const userContent = JSON.stringify({ enabled: true, mode: 'full', checks: {}, lineEnding: 'lf', copyrightInfo: { company: 'ACME' } });
  fs.writeFileSync(userPath, userContent);
  const before = fs.readFileSync(userPath);
  ensureUserTemplate(defaultPath, userPath);
  const after = fs.readFileSync(userPath);
  assert.ok(before.equals(after), 'an existing template is byte-identical before and after the write');

  // ---- ensureUserTemplate: copy when it does not exist ----
  const userPath2 = path.join(tmpl, 'fresh-template.json');
  ensureUserTemplate(defaultPath, userPath2);
  assert.ok(fs.existsSync(userPath2), 'copied from the default when missing');
  assert.ok(fs.readFileSync(userPath2).equals(fs.readFileSync(defaultPath)), 'the copied content matches the default');

  // ---- ensureUserTemplate: a copy failure does not crash (the default source does not exist) ----
  assert.doesNotThrow(() => ensureUserTemplate(path.join(tmpl, 'no-such.json'), path.join(tmpl, 'x.json')), 'a copy failure is caught and does not crash');

  // ---- loadConfig: field-level override (global template overlaid by the project) ----
  const proj = mkTmp('proj-');
  const cfgDir = path.join(proj, '.claude-cpp-style');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ mode: 'full', checks: { cpplint: false }, copyright: true, copyrightInfo: { company: 'OVERRIDE' } }));
  const srcFile = path.join(proj, 'a.cpp');
  fs.writeFileSync(srcFile, 'int a;');
  const cfg = loadConfig(srcFile, userPath);
  assert.strictEqual(cfg.mode, 'full', 'the project overrides mode=full');
  assert.strictEqual(cfg.checks.cpplint, false, 'the project overrides cpplint=false');
  assert.strictEqual(cfg.checks.bom, true, 'a checks field that is not overridden defaults to true');
  assert.strictEqual(cfg.checks.clangFormat, true, 'clangFormat that is not overridden defaults to true');
  // The removed copyright settings are dropped from the normalized config, whether they come from the global or the project layer.
  assert.strictEqual(cfg.copyrightInfo, undefined, 'copyrightInfo is ignored');
  assert.strictEqual(cfg.checks.copyright, undefined, 'checks.copyright is ignored');
  assert.strictEqual(cfg.lineEnding, 'lf', 'a field the project does not override falls back to the global layer');
  assert.strictEqual(cfg.enabled, true, 'enabled defaults to true');
  fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ lineEnding: 'crlf' }));
  assert.strictEqual(loadConfig(srcFile, userPath).lineEnding, 'crlf');
  fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ lineEnding: 'lf' }));
  assert.strictEqual(loadConfig(srcFile, userPath).lineEnding, 'lf');
  fs.writeFileSync(path.join(cfgDir, 'cpp-style.json'), JSON.stringify({ lineEnding: 'invalid' }));
  assert.strictEqual(loadConfig(srcFile, userPath).lineEnding, 'preserve');

  // ---- loadConfig: the project config is found by walking up (the file is in a subdirectory) ----
  const legacyProj = mkTmp('legacy-proj-');
  const legacyCfgDir = path.join(legacyProj, '.claude-cpp-style');
  fs.mkdirSync(legacyCfgDir, { recursive: true });
  fs.writeFileSync(path.join(legacyCfgDir, 'cpp-style.json'), JSON.stringify({ checks: { cpplint: false } }));
  fs.mkdirSync(path.join(legacyProj, 'src'));
  const legacySrc = path.join(legacyProj, 'src', 'legacy.cpp');
  fs.writeFileSync(legacySrc, 'int legacy;');
  assert.strictEqual(loadConfig(legacySrc, userPath).checks.cpplint, false, 'a file in a subdirectory finds the project config by walking up');

  // ---- loadConfig: corrupt JSON falls back to the defaults ----
  const proj2 = mkTmp('proj2-');
  const cfgDir2 = path.join(proj2, '.claude-cpp-style');
  fs.mkdirSync(cfgDir2, { recursive: true });
  fs.writeFileSync(path.join(cfgDir2, 'cpp-style.json'), '{ broken json ');
  const src2 = path.join(proj2, 'b.cpp');
  fs.writeFileSync(src2, 'int b;');
  const cfg2 = loadConfig(src2, path.join(tmpl, 'no-global.json'));
  assert.strictEqual(cfg2.enabled, true, 'corrupt JSON + no global -> hard-coded default enabled true');
  assert.strictEqual(cfg2.mode, 'incremental', 'corrupt JSON -> default incremental');
  assert.deepStrictEqual(cfg2.checks, { clangFormat: true, cpplint: true, bom: true }, 'corrupt JSON -> checks all default to true');
  assert.deepStrictEqual(
    cfg2.legacyChecks,
    { clangFormat: false, cpplint: false, bom: false },
    'corrupt JSON -> tracked files keep their encoding and format by default',
  );

  // ---- loadConfig: enabled:false takes effect ----
  const proj3 = mkTmp('proj3-');
  const cfgDir3 = path.join(proj3, '.claude-cpp-style');
  fs.mkdirSync(cfgDir3, { recursive: true });
  fs.writeFileSync(path.join(cfgDir3, 'cpp-style.json'), JSON.stringify({ enabled: false }));
  const src3 = path.join(proj3, 'c.cpp');
  fs.writeFileSync(src3, 'int c;');
  assert.strictEqual(loadConfig(src3, userPath).enabled, false, 'enabled:false is passed through');

  console.log('config.test.js PASS');
} finally {
  for (const d of cleanupDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
}
