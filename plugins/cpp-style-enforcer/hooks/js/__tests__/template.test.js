const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');

// The factory template must contain enabled/mode/lineEnding/checks/legacyChecks and be valid JSON
const tplPath = path.join(pluginRoot, 'templates', 'cpp-style-template.default.json');
assert.ok(fs.existsSync(tplPath), 'the factory template file should exist');
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf-8'));
assert.strictEqual(tpl.enabled, true, 'enabled defaults to true');
assert.strictEqual(tpl.mode, 'incremental', 'mode defaults to incremental');
assert.deepStrictEqual(tpl.checks, { clangFormat: true, cpplint: true, bom: true }, 'all three checks default to true');
assert.deepStrictEqual(
  tpl.legacyChecks,
  { clangFormat: false, cpplint: false, bom: false },
  'tracked files keep their original encoding and format by default',
);
assert.strictEqual(tpl.lineEnding, 'preserve', 'non-VS projects keep the original line endings by default');
assert.strictEqual(tpl.copyrightInfo, undefined, 'the removed copyright settings are not part of the template');
assert.strictEqual(tpl.checks.copyright, undefined, 'the removed copyright check is not part of the template');

// plugin.json / package.json / marketplace.json versions must agree, so the release numbers cannot drift
const pj = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf-8'));
const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf-8'));
const market = JSON.parse(fs.readFileSync(path.join(pluginRoot, '..', '..', '.claude-plugin', 'marketplace.json'), 'utf-8'));
const marketEntry = market.plugins.find((p) => p.name === 'cpp-style-enforcer');
assert.ok(marketEntry, 'marketplace.json should include cpp-style-enforcer');
assert.strictEqual(pkg.version, pj.version, 'the package.json version should match plugin.json');
assert.strictEqual(marketEntry.version, pj.version, 'the marketplace.json version should match plugin.json');

// The directory skeleton exists
for (const d of ['hooks/js/lib', 'hooks/js/steps', 'hooks/js/__tests__']) {
  assert.ok(fs.existsSync(path.join(pluginRoot, d)), `${d} directory should exist`);
}
console.log('template.test.js PASS');
