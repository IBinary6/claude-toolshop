#!/usr/bin/env node
// ABOUTME: PreToolUse:Agent 软提示 - 根据任务语义推荐插件内置 Claude subagent
// ABOUTME: 已选择匹配的 scoped agent 时静默，不干预用户显式模型选择

'use strict';

const path = require('path');
const { readStdinJson } = require(path.resolve(__dirname, '../lib/utils'));

const { loadConfig, loadDefaults } = require('../lib/config');
const { agentNudge } = require('../lib/guidance');
const { hookCwd } = require('../lib/marker');

async function main() {
  let input;
  try { input = await readStdinJson(); } catch { process.exit(0); return; }
  if (!input) { process.exit(0); return; }

  const toolInput = input.tool_input || {};

  let config;
  try { config = loadConfig(hookCwd(input)); } catch (_) { config = loadDefaults(); }
  const context = agentNudge(toolInput, config);
  if (!context) { process.exit(0); return; }

  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: context,
      },
    }) + '\n');
  } catch (e) {}

  process.exit(0);
}

main();
