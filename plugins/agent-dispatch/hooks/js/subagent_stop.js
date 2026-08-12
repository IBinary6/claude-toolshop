#!/usr/bin/env node
'use strict';

const { loadConfig, loadDefaults } = require('./lib/config');
const { missingReportSections } = require('./lib/guidance');
const { hookCwd } = require('./lib/marker');
const { output, readStdinJson } = require('./lib/utils');

async function main() {
  const input = await readStdinJson({ timeoutMs: 2000 });
  if (!input || input.stop_hook_active === true) return;
  let config;
  try { config = loadConfig(hookCwd(input)); } catch (_) { config = loadDefaults(); }
  if (!config.modules.subagent_report_guard) return;
  const missing = missingReportSections(input.last_assistant_message, config);
  if (missing.length === 0) return;
  output({
    decision: 'block',
    reason: `最终报告缺少 ${missing.join(', ')}。请补齐缺少的小节后再结束；没有内容时明确写 none。`,
  });
}

main().catch(() => {});
