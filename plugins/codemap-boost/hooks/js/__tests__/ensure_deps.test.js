'use strict';
// ABOUTME: ensure_deps.js 单元测试 — 纯断言，依赖注入，绝不真跑 pip。
// 运行：node hooks/js/__tests__/ensure_deps.test.js
//
// 覆盖意图（规则 9：测试编码行为为何重要）：
//   - 模块可 require 且导出齐全（坏掉则各 hook 自举入口直接崩）。
//   - 命令已可用时 NOT 触发安装（避免对已装环境无谓 pip）。
//   - 显式 setup helper 缺失时调用 pip 装、装后复检可用则返回 true。
//   - 装失败写标记，二次调用读标记直接降级、NOT 重试（防重复装）。
//   - ensureGraphify 用的 pip 包名必须是 graphifyy[all]（双 y + extras，最关键的 bug）。
//   - probeCommand 对不存在命令安全返回 false 且不抛（降级不崩）。
//   - spawnPrewarm 保持 no-op，防止 hook 后台自动安装依赖。

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const mod = require('../lib/ensure_deps');

let pass = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}\n    ${e && e.message}`);
    process.exitCode = 1;
  }
}

// 唯一临时标记路径，避免污染真实 PLUGIN_DATA / tmpdir 既有标记
function tmpMarker(tag) {
  return path.join(os.tmpdir(), `codemap-test-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}
function cleanup(p) { try { fs.unlinkSync(p); } catch (_) {} }

// --- 模块契约 ---
test('module requires & exports expected fns', () => {
  for (const k of ['ensureCrg', 'ensureGraphify', 'ensureCrgMcp', 'ensureCli', 'probeCommand', 'pipInstall', 'markerPath', 'spawnPrewarm']) {
    assert.strictEqual(typeof mod[k], 'function', `missing export: ${k}`);
  }
});

// --- 已可用 → 不安装 ---
test('ensureCli: cmd available -> returns true, install NOT called', () => {
  let installCalls = 0;
  const r = mod.ensureCli(
    { cmd: 'x', pkg: 'x', marker: '.x' },
    { probe: () => true, install: () => { installCalls++; return true; }, markerPath: tmpMarker('avail') }
  );
  assert.strictEqual(r, true);
  assert.strictEqual(installCalls, 0, 'install must not run when cmd already available');
});

// --- 缺失 → 装 → 复检通过 ---
test('ensureCli: missing -> install -> recheck ok -> true', () => {
  let probeCalls = 0;
  let installedPkg = null;
  const r = mod.ensureCli(
    { cmd: 'x', pkg: 'mypkg', marker: '.x' },
    {
      probe: () => (++probeCalls > 1), // 1st false, 2nd true
      install: (pkg) => { installedPkg = pkg; return true; },
      markerPath: tmpMarker('inst-ok'),
    }
  );
  assert.strictEqual(r, true);
  assert.strictEqual(installedPkg, 'mypkg', 'install must receive the pip package name');
});

// --- 装失败 → 写标记 → 二次调用读标记不重试 ---
test('ensureCli: install fails -> writes marker -> 2nd call skips install', () => {
  const marker = tmpMarker('fail');
  let installCalls = 0;
  const opts = {
    probe: () => false,                       // 始终不可用
    install: () => { installCalls++; return false; },
    markerPath: marker,
  };
  const r1 = mod.ensureCli({ cmd: 'x', pkg: 'x', marker: '.x' }, opts);
  assert.strictEqual(r1, false);
  assert.strictEqual(installCalls, 1, 'first call attempts install once');
  assert.ok(fs.existsSync(marker), 'failure marker should be written');

  const r2 = mod.ensureCli({ cmd: 'x', pkg: 'x', marker: '.x' }, opts);
  assert.strictEqual(r2, false);
  assert.strictEqual(installCalls, 1, 'second call must NOT retry install (marker guards)');
  cleanup(marker);
});

// --- 包名 bug 守卫：graphify 命令 → graphifyy 包 ---
test('ensureGraphify: installs pip package "graphifyy[all]" (double y), not "graphify"', () => {
  let installedPkg = null;
  mod.ensureGraphify({
    probe: () => false,
    install: (pkg) => { installedPkg = pkg; return false; }, // 装失败即可，只验包名
    markerPath: tmpMarker('graphify-pkg'),
  });
  assert.strictEqual(installedPkg, 'graphifyy[all]', 'graphify CLI must be installed via pip package "graphifyy[all]"');
});

// --- 包名守卫：crg 命令与 extras ---
test('ensureCrg: installs pip package "code-review-graph[all]"', () => {
  let installedPkg = null;
  mod.ensureCrg({
    probe: () => false,
    install: (pkg) => { installedPkg = pkg; return false; },
    markerPath: tmpMarker('crg-pkg'),
  });
  assert.strictEqual(installedPkg, 'code-review-graph[all]');
});

// --- MCP 显式注册 helper：未注册时执行 install，成功后复检 ---
test('ensureCrgMcp: unregistered -> register -> recheck ok -> true', () => {
  const marker = tmpMarker('mcp-register-ok');
  let registered = false;
  let registerCalls = 0;
  const r = mod.ensureCrgMcp({
    isRegistered: () => registered,
    register: () => { registerCalls++; registered = true; return true; },
    markerPath: marker,
  });
  assert.strictEqual(r, true);
  assert.strictEqual(registerCalls, 1, 'MCP register must run when server is missing');
  assert.strictEqual(fs.existsSync(marker), false, 'successful MCP registration must not write failure marker');
});

test('ensureCrgMcp: registered -> true, register NOT called', () => {
  let registerCalls = 0;
  const r = mod.ensureCrgMcp({
    isRegistered: () => true,
    register: () => { registerCalls++; return true; },
  });
  assert.strictEqual(r, true);
  assert.strictEqual(registerCalls, 0, 'register must not run when MCP is already registered');
});

test('ensureCrgMcp: register fails -> writes marker -> 2nd call skips register', () => {
  const marker = tmpMarker('mcp-register-fail');
  let registerCalls = 0;
  const opts = {
    isRegistered: () => false,
    register: () => { registerCalls++; return false; },
    markerPath: marker,
  };
  const r1 = mod.ensureCrgMcp(opts);
  assert.strictEqual(r1, false);
  assert.strictEqual(registerCalls, 1);
  assert.ok(fs.existsSync(marker), 'failure marker should be written');

  const r2 = mod.ensureCrgMcp(opts);
  assert.strictEqual(r2, false);
  assert.strictEqual(registerCalls, 1, 'marker must prevent repeated MCP registration attempts');
  cleanup(marker);
});

// --- probeCommand 对不存在命令安全降级 ---
test('probeCommand: nonexistent command -> false, no throw', () => {
  const r = mod.probeCommand('definitely-not-a-real-cmd-xyz-123');
  assert.strictEqual(r, false);
});

test('spawnPrewarm: deprecated no-op, does not start background installer', () => {
  assert.strictEqual(mod.spawnPrewarm(), null);
});

console.log(`\nensure_deps: ${pass} passed${process.exitCode ? ' (with failures)' : ''}`);
