#!/usr/bin/env node
// ABOUTME: PreToolUse:Agent 软提示 - 研究/探索类子代理缺 model 字段时提醒显式指定
// ABOUTME: 不阻断调用，仅 additionalContext 软提示，避免继承父会话高成本模型

'use strict';

const { readStdinJson } = require('./lib/utils');

const RESEARCH_TYPES = new Set(['Explore', 'Plan', 'architect']);

const RESEARCH_KEYWORDS = [
  '探索', '搜索', '分析', '对比', '排查', '检查', '查找', '扫描', '定位', '查看',
  'find', 'search', 'explore', 'analyz', 'compar', 'read', 'check', 'locate',
  'review', 'research', 'investigat', 'understand', 'scan', 'audit', 'look',
  'inspect', 'examine', 'survey', 'identif',
];

function isResearchCall(toolInput) {
  if (RESEARCH_TYPES.has(toolInput.subagent_type || '')) return true;
  const text = [
    toolInput.description || '',
    (toolInput.prompt || '').slice(0, 400),
  ].join(' ').toLowerCase();
  return RESEARCH_KEYWORDS.some((kw) => text.includes(kw));
}

async function main() {
  let input;
  try { input = await readStdinJson(); } catch { process.exit(0); return; }
  if (!input) { process.exit(0); return; }

  const toolInput = input.tool_input || {};

  // 已显式指定 model → 无需提示
  if (toolInput.model) { process.exit(0); return; }

  // 非研究类 → 无需提示
  if (!isResearchCall(toolInput)) { process.exit(0); return; }

  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          '提示：研究/探索类子代理建议显式指定 model: "sonnet"，' +
          '避免继承父会话模型（如 Opus）导致 token 成本虚高。\n' +
          '示例：Agent({ subagent_type: "...", model: "sonnet", ... })',
      },
    }) + '\n');
  } catch (e) {}

  process.exit(0);
}

main();
