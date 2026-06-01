#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 延迟激活 dispatcher 角色指令
 * ABOUTME: 仅在会话中首次 block 发生后才注入（通过标记文件判断）
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

  const message = [
    '## Agent Dispatch Policy [ACTIVE — previously blocked]',
    '',
    'You are the ORCHESTRATOR. Your context window is protected.',
    '',
    'DELEGATION RULES:',
    '1. Heavy work (builds, tests, research, multi-step shell) → Agent({ description, prompt })',
    '2. You may directly: read files, small edits, coordinate, search memory/knowledge',
    '3. When a tool is BLOCKED, your ONLY valid response is spawning a subagent',
    '4. NEVER use alternative tools to work around a block — delegate the original task',
    '5. NEVER say "let me try another approach" to avoid delegation',
  ].join('\n');

  console.log(message);
}

main();
