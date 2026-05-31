#!/usr/bin/env node
'use strict';

const { readStdinJson, output, log } = require('./lib/utils');
const { loadConfig } = require('./lib/config');
const { isWhitelistedTool, isWhitelistedMcp, isSafeBashCommand } = require('./lib/rules');

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    process.exit(0);
    return;
  }
  if (!input) { process.exit(0); return; }

  if (input.agent_id) { process.exit(0); return; }

  const config = loadConfig();
  if (!config.modules.enforcer) { process.exit(0); return; }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (isWhitelistedTool(toolName, config)) { process.exit(0); return; }

  if (isWhitelistedMcp(toolName, config)) { process.exit(0); return; }

  if ((toolName === 'Bash' || toolName === 'PowerShell') && isSafeBashCommand(toolInput.command, config)) {
    process.exit(0);
    return;
  }

  log(`[agent-dispatch] BLOCKED: ${toolName}`);
  output({
    decision: 'block',
    reason:
      `⚠ BLOCKED: Main agent may NOT call [${toolName}] directly.\n` +
      `You MUST use the Agent tool to delegate this to a subagent.\n` +
      `Example: Agent({ description: "run ${toolName} task", prompt: "..." })`,
  });
  process.exit(0);
}

main();
