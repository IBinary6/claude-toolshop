'use strict';
// ABOUTME: prompt_inject.js 集成测试 — 验证一次性触发和消息格式

const assert = require('assert').strict;
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const INJECT = path.resolve(__dirname, '..', 'prompt_inject.js');

function markerPathFor(tmpDir, input) {
  const sessionId = input.session_id || input.sessionId || '';
  const cwd = input.cwd || process.cwd();
  const key = crypto.createHash('sha1')
    .update(`${sessionId}\n${path.resolve(cwd)}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpDir, `.agent-dispatch-blocked-${key}`);
}

/**
 * 运行 prompt_inject，并控制标记文件状态
 * @param {object} opts
 * @param {boolean} opts.hasMarker - 是否预先写入标记文件
 * @param {boolean} opts.promptInjectEnabled - config 中是否启用 prompt_inject
 * @param {string|null} opts.overrideCwd - 覆盖进程 cwd（用于测试项目级配置）
 * @param {string|null} opts.inputCwd - hook stdin cwd
 */
function runInject({ hasMarker = false, promptInjectEnabled = true, overrideCwd = null, inputCwd = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-test-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-home-'));
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'hello' };
  // cwd 决定 config 从哪里加载 .agent-dispatch.json
  const cwd = overrideCwd || path.resolve(__dirname, '..', '..', '..');
  input.cwd = inputCwd || cwd;
  const markerFile = markerPathFor(tmpDir, input);

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

  const r = spawnSync('node', [INJECT], {
    input: JSON.stringify(input),
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

// --- 注入消息含防缓存失效规则：子代理改文件须回传路径 ---
{
  const r = runInject({ hasMarker: true });
  assert.ok(/被改文件|修改文件|文件路径/.test(r.stdout) && /重读|缓存/.test(r.stdout),
    '注入消息应要求子代理回传被改文件路径、主 agent 重读以保持缓存一致');
}

// --- 其他 cwd/session 的标记不应串到当前 prompt ---
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-scope-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-scope-home-'));
  const currentInput = { hook_event_name: 'UserPromptSubmit', prompt: 'hello', cwd: path.join(tmpDir, 'repo-a') };
  const otherInput = { hook_event_name: 'UserPromptSubmit', prompt: 'hello', cwd: path.join(tmpDir, 'repo-b') };
  fs.mkdirSync(currentInput.cwd, { recursive: true });
  fs.mkdirSync(otherInput.cwd, { recursive: true });
  fs.writeFileSync(markerPathFor(tmpDir, otherInput), String(Date.now()));
  const r = spawnSync('node', [INJECT], {
    input: JSON.stringify(currentInput),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, TMPDIR: tmpDir, TEMP: tmpDir, TMP: tmpDir },
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  assert.equal((r.stdout || '').trim(), '', '其他 cwd 的 marker 不应触发当前 prompt');
}

// --- prompt_inject 关闭时 → 不注入 ---
{
  // 需要让 hook 的 cwd 指向含 .agent-dispatch.json 的目录，config 才会生效
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-disabled-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-disabled-home-'));
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'hello', cwd: cfgDir };
  const markerFile = markerPathFor(cfgDir, input);
  fs.writeFileSync(markerFile, String(Date.now())); // 有标记
  fs.writeFileSync(
    path.join(cfgDir, '.agent-dispatch.json'),
    JSON.stringify({ modules: { prompt_inject: false } })
  );
  const r = spawnSync('node', [INJECT], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, TMPDIR: cfgDir, TEMP: cfgDir, TMP: cfgDir },
  });
  fs.rmSync(cfgDir, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  assert.equal((r.stdout || '').trim(), '', 'prompt_inject 关闭时应无输出');
}

console.log('✓ prompt_inject.test.js — all assertions passed');
