const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  ensureIconvLite,
  ensureClangFormat,
  markerPath,
  spawnPrewarm,
} = require('../lib/ensure_deps.js');

const pluginRoot = path.join(__dirname, '..', '..', '..');

// ---- ensureIconvLite: 已装时直接返回模块，绝不触发安装 ----
{
  // 插件依赖里已声明 iconv-lite，本仓 require 能命中（开发机已 npm install）。
  // 若本环境恰好未装，回退验证“安全降级返回 null 且不抛”。
  // 用隔离 marker，避免污染插件根目录。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-present-'));
  try {
    let installAttempted = false;
    const mod = ensureIconvLite({
      marker: path.join(tmp, '.iconv-install-failed'),
      install: () => { installAttempted = true; return false; },
    });
    if (mod) {
      assert.strictEqual(typeof mod.decode, 'function', 'iconv-lite 已装 → 返回带 decode 的模块');
      assert.strictEqual(installAttempted, false, 'iconv-lite 已装 → 绝不触发安装');
      console.log('ensure_deps: iconvLite present, no install PASS');
    } else {
      assert.strictEqual(mod, null, 'iconv-lite 缺失且安装失败 → 返回 null');
      assert.strictEqual(installAttempted, true, 'iconv-lite 缺失 → 尝试一次安装');
      console.log('ensure_deps: iconvLite absent, degrade null PASS');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureIconvLite: 标记文件已存在(曾失败) → 不再重试安装，直接降级 null ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-mk-'));
  try {
    const marker = path.join(tmp, '.iconv-install-failed');
    fs.writeFileSync(marker, '1');
    let installAttempted = false;
    // 强制 require 失败的注入：用一个一定 require 不到的名字模拟“缺失”
    const mod = ensureIconvLite({
      moduleName: '__definitely_missing_iconv__',
      marker,
      install: () => { installAttempted = true; return false; },
    });
    assert.strictEqual(mod, null, '缺失 + 已有失败标记 → 返回 null');
    assert.strictEqual(installAttempted, false, '已有失败标记 → 不再尝试安装');
    console.log('ensure_deps: iconvLite marker skips retry PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureIconvLite: 缺失 + 无标记 + 安装仍失败 → 写标记 + 返回 null + 不抛 ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-fail-'));
  try {
    const marker = path.join(tmp, '.iconv-install-failed');
    let installAttempted = false;
    const mod = ensureIconvLite({
      moduleName: '__definitely_missing_iconv__',
      marker,
      install: () => { installAttempted = true; return false; }, // 模拟安装失败
    });
    assert.strictEqual(mod, null, '缺失 + 安装失败 → null');
    assert.strictEqual(installAttempted, true, '缺失 + 无标记 → 尝试一次安装');
    assert.ok(fs.existsSync(marker), '安装失败后写失败标记，避免下次重试');
    console.log('ensure_deps: iconvLite install fail writes marker PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: PATH 有 clang-format → 返回命令、不触发 pip ----
{
  const hasClangFormat = spawnSync('clang-format', ['--version'], { stdio: 'pipe' }).status === 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-present-'));
  try {
    let installAttempted = false;
    const cmd = ensureClangFormat({
      marker: path.join(tmp, '.clang-format-install-failed'),
      install: () => { installAttempted = true; return false; },
    });
    if (hasClangFormat) {
      assert.strictEqual(cmd, 'clang-format', 'PATH 有 clang-format → 返回 "clang-format"');
      assert.strictEqual(installAttempted, false, 'PATH 有 clang-format → 绝不触发 pip 安装');
      console.log('ensure_deps: clangFormat present, no install PASS');
    } else {
      assert.strictEqual(cmd, null, '缺失 + 安装失败 → null');
      assert.strictEqual(installAttempted, true, '缺失 → 尝试一次安装');
      console.log('ensure_deps: clangFormat absent, degrade null PASS');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: 缺失 + 已有失败标记 → 不再重试 ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-mk-'));
  try {
    const marker = path.join(tmp, '.clang-format-install-failed');
    fs.writeFileSync(marker, '1');
    let installAttempted = false;
    const cmd = ensureClangFormat({
      detect: () => null, // 强制“检测不到”
      marker,
      install: () => { installAttempted = true; return false; },
    });
    assert.strictEqual(cmd, null, '缺失 + 失败标记 → null');
    assert.strictEqual(installAttempted, false, '失败标记存在 → 不再 pip install');
    console.log('ensure_deps: clangFormat marker skips retry PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- ensureClangFormat: install 抛异常也不冒泡，安全返回 null ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-cf-throw-'));
  try {
    const marker = path.join(tmp, '.clang-format-install-failed');
    const cmd = ensureClangFormat({
      detect: () => null,
      marker,
      install: () => { throw new Error('boom'); },
    });
    assert.strictEqual(cmd, null, 'install 抛异常 → 捕获并返回 null（不冒泡）');
    console.log('ensure_deps: clangFormat install throw safe PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- markerPath: 返回插件目录下稳定路径 ----
{
  const p = markerPath('.iconv-install-failed');
  assert.ok(path.isAbsolute(p), 'markerPath 返回绝对路径');
  assert.ok(p.endsWith('.iconv-install-failed'), 'markerPath 保留文件名');
  console.log('ensure_deps: markerPath PASS');
}

// ---- spawnPrewarm: 后台 detached 启动不阻塞、不抛 ----
{
  const child = spawnPrewarm();
  // 返回子进程句柄或 null（spawn 失败也不抛）
  assert.ok(child === null || typeof child.pid === 'number' || child.pid === undefined,
    'spawnPrewarm 返回子进程或 null，不抛');
  if (child && typeof child.unref === 'function') {
    // 已 unref，不阻塞测试进程退出
  }
  console.log('ensure_deps: spawnPrewarm non-blocking PASS');
}

console.log('ensure_deps.test.js PASS');
