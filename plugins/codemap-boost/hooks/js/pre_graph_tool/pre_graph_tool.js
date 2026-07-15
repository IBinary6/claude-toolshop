#!/usr/bin/env node
// ABOUTME: PreToolUse 图谱 MCP 屏障 - 读图前同步刷新 code-review-graph
// ABOUTME: 刷新失败时阻止本次图谱读取，避免使用过期图谱上下文

'use strict';

const { commandExists, isGitRepo, output, readStdinJson } = require('../lib/utils');
const { refreshCrgSync } = require('../lib/crg_refresh');

function hookCwd(input, env = process.env, cwd = process.cwd()) {
  const requested = input && input.tool_input && input.tool_input.repo_root;
  if (typeof requested === 'string' && requested.trim()) return requested;
  return env.CLAUDE_WORKING_DIRECTORY || cwd;
}

function denyPayload(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function deny(reason, write = output) {
  write(denyPayload(reason));
}

async function run(deps = {}) {
  const read = deps.readStdinJson || readStdinJson;
  const isRepo = deps.isGitRepo || isGitRepo;
  const exists = deps.commandExists || commandExists;
  const refresh = deps.refreshCrgSync || refreshCrgSync;
  const write = deps.output || output;
  const env = deps.env || process.env;
  const cwd = deps.cwd || process.cwd();
  const input = await read({ timeoutMs: 2000 });
  const root = hookCwd(input, env, cwd);
  if (!isRepo(root)) return { allowed: true, reason: 'not-git' };
  if (!exists('code-review-graph')) {
    const reason = 'CodeMap 图谱工具被暂时阻止：code-review-graph CLI 尚未可用。请运行 /codemap-boost-setup 后重试。';
    deny(reason, write);
    return { allowed: false, reason };
  }
  if (!refresh(root)) {
    const reason = 'CodeMap 图谱工具被暂时阻止：必要的 build/update 未完成。请等待当前刷新结束后重试。';
    deny(reason, write);
    return { allowed: false, reason };
  }
  return { allowed: true, reason: 'refreshed' };
}

if (require.main === module) {
  run().catch(() => deny('CodeMap 图谱工具被暂时阻止：刷新屏障执行失败，请稍后重试。'));
}

module.exports = {
  denyPayload,
  hookCwd,
  run,
};
