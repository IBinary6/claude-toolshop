#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 延迟激活 dispatcher 角色指令
 * ABOUTME: 仅在上次 block 后的下一条 prompt 注入一次，注入后立即删标记
 * ABOUTME: 由 config.modules.prompt_inject 控制总开关
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('./lib/config');

const MARKER_FILE = path.join(os.tmpdir(), '.agent-dispatch-blocked');
const MARKER_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时过期

/**
 * 检查是否在 TTL 内被 block 过
 */
function isRecentlyBlocked() {
  try {
    const stat = fs.statSync(MARKER_FILE);
    return (Date.now() - stat.mtimeMs) < MARKER_TTL_MS;
  } catch {
    return false;
  }
}

function main() {
  const config = loadConfig();
  if (!config.modules.prompt_inject) return;
  if (!isRecentlyBlocked()) return;

  // 一次性触发：注入后立即删标记，避免后续每条 prompt 都注入
  try { fs.unlinkSync(MARKER_FILE); } catch {}

  const message = [
    '## Agent Dispatch Policy [ACTIVE — previously blocked]',
    '',
    '你是 ORCHESTRATOR。委派规则：',
    '1. 重型工作（构建、测试、研究、多步 shell）→ Agent({ description, prompt })',
    '2. 可直接执行：读文件、改代码(Edit/Write)、协调、查记忆/知识库',
    '3. 工具被拦截时唯一正确响应是派遣子代理，不要换工具绕过',
    '4. 子代理若修改文件，必须在报告中列出被改文件路径；主 agent 重读后再续，保证缓存一致',
  ].join('\n');

  console.log(message);
}

main();
