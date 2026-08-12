#!/usr/bin/env node
'use strict';

const { loadConfig, loadDefaults } = require('./lib/config');
const { subagentGuidance } = require('./lib/guidance');
const { hookCwd } = require('./lib/marker');
const { output, readStdinJson } = require('./lib/utils');

async function main() {
  const input = await readStdinJson({ timeoutMs: 2000 });
  if (!input) return;
  let config;
  try { config = loadConfig(hookCwd(input)); } catch (_) { config = loadDefaults(); }
  if (!config.modules.subagent_guidance) return;
  output({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: subagentGuidance(config),
    },
  });
}

main().catch(() => {});
