'use strict';
// ABOUTME: prompt_inject.js 集成测试 — 验证一次性触发和消息格式

const assert = require('assert').strict;
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const INJECT = path.resolve(__dirname, '..', 'prompt_inject.js');
const MARKER_NAME = '.agent-dispatch-blocked';

/**
 * 运行 prompt_inject，并控制标记文件状态
 * @param {object} opts
 * @param {boolean} opts.hasMarker - 是否预先写入标记文件
 * @param {boolean} opts.promptInjectEnabled - config 中是否启用 prompt_inject
 * @param {string|null} opts.overrideCwd - 覆盖 cwd（用于测试项目级配置）
 */
function runInject({ hasMarker = false, promptInjectEnabled = true, overrideCwd = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-test-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-home-'));
  const markerFile = path.join(tmpDir, MARKER_NAME);

  // 写 marker（模拟上次发生过 block）
  if (hasMarker) {
    fs.writeFileSync(markerFile, String(Date.now()));
  }

  // 写项目配置覆盖
  if (!promptInjectEnabled) {
    fs.writeFileSync(
      path.join(tmpDir, '.agent-dispatch.json'),
      JSON.stringify({ modules: { prompt_inject: false } })
    );
  }

  const env = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  // cwd 决定 config 从哪里加载 .agent-dispatch.json
  const cwd = overrideCwd || path.resolve(__dirname, '..', '..', '..');

  const r = spawnSync('node', [INJECT], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
    encoding: 'utf-8',
    timeout: 10000,
    cwd,
    env,
  });

  const markerExistsAfter = fs.existsSync(markerFile);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });

  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    markerExistsAfter,
  };
}

// --- 无标记文件 → 不注入（静默退出）---
{
  const r = runInject({ hasMarker: false });
  assert.equal(r.status, 0, '无标记时应 exit 0');
  assert.equal(r.stdout, '', '无标记时应无输出');
}

// --- 有标记文件 → 注入一次并删除标记 ---
{
  const r = runInject({ hasMarker: true });
  assert.equal(r.status, 0, '有标记时应 exit 0');
  assert.notEqual(r.stdout, '', '有标记时应有注入输出');
  assert.ok(r.stdout.includes('ORCHESTRATOR') || r.stdout.includes('委派'), '注入内容应包含委派角色描述');
  assert.equal(r.markerExistsAfter, false, '注入后标记文件应被删除（一次性触发）');
}

// --- 注入消息长度合理（不超过 8 行）---
{
  const r = runInject({ hasMarker: true });
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.ok(lines.length <= 8, `注入消息应不超过 8 行，实际 ${lines.length} 行`);
}

// --- prompt_inject 关闭时 → 不注入 ---
{
  // 需要让 hook 的 cwd 指向含 .agent-dispatch.json 的目录，config 才会生效
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-disabled-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-disabled-home-'));
  const markerFile = path.join(cfgDir, MARKER_NAME);
  fs.writeFileSync(markerFile, String(Date.now())); // 有标记
  fs.writeFileSync(
    path.join(cfgDir, '.agent-dispatch.json'),
    JSON.stringify({ modules: { prompt_inject: false } })
  );
  const r = spawnSync('node', [INJECT], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: cfgDir,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, TMPDIR: cfgDir, TEMP: cfgDir, TMP: cfgDir },
  });
  fs.rmSync(cfgDir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  assert.equal((r.stdout || '').trim(), '', 'prompt_inject 关闭时应无输出');
}

console.log('✓ prompt_inject.test.js — all assertions passed');
