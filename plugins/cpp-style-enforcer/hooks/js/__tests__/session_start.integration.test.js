const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const entry = path.join(pluginRoot, 'hooks', 'js', 'session_start.js');

// 用临时 HOME 隔离全局模板，避免污染真实 ~/.claude
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cse-home-'));
const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
const userTpl = path.join(tmpHome, '.claude', 'cpp-style-template.json');

function runHook() {
  const r = spawnSync('node', [entry], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf-8',
    timeout: 10000,
    env,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

try {
  // 1) 首次运行 → 创建全局模板，无输出，exit 0
  {
    const r = runHook();
    assert.strictEqual(r.status, 0, 'SessionStart 应 exit 0');
    assert.strictEqual(r.stdout, '', 'SessionStart 应 stdout 空（完全静默）');
    assert.strictEqual(r.stderr, '', 'SessionStart 应 stderr 空（完全静默）');
    assert.ok(fs.existsSync(userTpl), '首次运行应创建全局模板');
  }

  // 2) 已存在用户自填模板 → 绝不覆盖（字节级一致）
  {
    const custom = JSON.stringify({ enabled: true, mode: 'full', copyrightInfo: { company: 'ACME' } });
    fs.writeFileSync(userTpl, custom);
    const before = fs.readFileSync(userTpl);
    const r = runHook();
    assert.strictEqual(r.status, 0, '二次运行应 exit 0');
    const after = fs.readFileSync(userTpl);
    assert.ok(before.equals(after), '已存在模板必须字节级不变（不覆盖用户 company）');
  }

  console.log('session_start.integration.test.js PASS');
} finally {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
}
