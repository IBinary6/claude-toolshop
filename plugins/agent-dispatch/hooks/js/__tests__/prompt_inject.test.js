'use strict';

const assert = require('assert').strict;
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INJECT = path.resolve(__dirname, '..', 'prompt_inject.js');

function markerPathFor(tmpDir, input) {
  const sessionId = input.session_id || input.sessionId || '';
  const key = crypto.createHash('sha1')
    .update(`${sessionId}\n${path.resolve(input.cwd)}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpDir, `.agent-dispatch-blocked-${key}`);
}

function runInject({ prompt = 'hello', hasMarker = false, enabled = true } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-repo-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-home-'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-marker-'));
  const input = {
    hook_event_name: 'UserPromptSubmit',
    prompt,
    cwd: repo,
    session_id: 'session-a',
  };
  const markerFile = markerPathFor(tempDir, input);
  if (hasMarker) fs.writeFileSync(markerFile, String(Date.now()));
  if (!enabled) {
    fs.writeFileSync(
      path.join(repo, '.agent-dispatch.json'),
      JSON.stringify({ modules: { prompt_inject: false } })
    );
  }

  const result = spawnSync('node', [INJECT], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: repo,
    env: {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      TMPDIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
    },
  });
  const markerExistsAfter = fs.existsSync(markerFile);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    markerExistsAfter,
  };
}

function additionalContext(result) {
  assert.equal(result.status, 0);
  assert.notEqual(result.stdout, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return parsed.hookSpecificOutput.additionalContext;
}

// marker 不再是路由前提：常规实现直接推荐 Claude 原生 scoped agent。
{
  const result = runInject({ prompt: '请实现输入校验并补充测试' });
  const context = additionalContext(result);
  assert.ok(context.includes('agent-dispatch:dispatch-worker'));
  assert.equal(result.markerExistsAfter, false);
}

// 琐碎改动由主 Agent 直接完成，不为了分工而分工。
{
  const result = runInject({ prompt: '修复这一行的 typo' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
}

// 高风险实现：主 Agent 先核对契约与授权，不因风险关键词强制规划或升级 opus。
{
  const result = runInject({ prompt: '实现权限校验并修复安全漏洞' });
  const context = additionalContext(result);
  assert.ok(context.includes('主 Agent 先核对真实调用路径'));
  assert.ok(context.includes('agent-dispatch:dispatch-worker'));
  assert.ok(!context.includes('dispatch-planner'));
}

// 明确要求先出方案的困难任务：planner 只读规划，主 Agent 拍板后交困难实现角色。
{
  const result = runInject({ prompt: '请先制定计划，然后实现复杂的跨模块缓存迁移' });
  const context = additionalContext(result);
  assert.ok(context.includes('dispatch-planner'));
  assert.ok(context.includes('dispatch-hard-worker'));
}

// marker 只作为失败恢复补充，消费后删除。
{
  const result = runInject({ prompt: 'hello', hasMarker: true });
  const context = additionalContext(result);
  assert.ok(context.includes('上次工具调用被拦截'));
  assert.equal(result.markerExistsAfter, false);
}

// 模块关闭时，即使任务匹配也不注入。
{
  const result = runInject({ prompt: '请实现输入校验并补测试', enabled: false });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
}

console.log('✓ prompt_inject.test.js — all assertions passed');
