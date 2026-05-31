#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 注入 dispatcher 角色指令（可选，默认关闭）
 * ABOUTME: 由 config.modules.prompt_inject 控制开关
 */

const { loadConfig } = require('./lib/config');

function main() {
  const config = loadConfig();
  if (!config.modules.prompt_inject) return;

  const message = [
    '## Agent Dispatch Policy',
    '',
    'You are a DISPATCHER. Delegate actual work via Agent tool.',
    'You may directly: coordinate tasks, read files for dispatch decisions, make trivial edits.',
    'You must delegate: research, builds, analysis, multi-file changes, heavy MCP calls.',
  ].join('\n');

  console.log(message);
}

main();
