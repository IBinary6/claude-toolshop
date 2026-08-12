#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 按当前任务注入 Claude 原生 agent 路由
 * ABOUTME: 上次 block marker 只补充恢复提示，不再是路由生效前提
 * ABOUTME: 由 config.modules.prompt_inject 控制总开关
 */

const fs = require('fs');
const { loadConfig } = require('./lib/config');
const { promptGuidance } = require('./lib/guidance');
const { blockedMarkerPath, hookCwd } = require('./lib/marker');
const { output, readStdinJson } = require('./lib/utils');

const MARKER_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时过期

/**
 * 检查是否在 TTL 内被 block 过
 */
function isRecentlyBlocked(markerFile) {
  try {
    const stat = fs.statSync(markerFile);
    return (Date.now() - stat.mtimeMs) < MARKER_TTL_MS;
  } catch {
    return false;
  }
}

async function main() {
  const input = await readStdinJson({ timeoutMs: 1000 });
  const cwd = hookCwd(input);
  const config = loadConfig(cwd);
  const markerFile = blockedMarkerPath(input);
  if (!config.modules.prompt_inject) return;
  const lines = [];
  if (isRecentlyBlocked(markerFile)) {
    try { fs.unlinkSync(markerFile); } catch {}
    lines.push('上次工具调用被拦截：先划定可独立委派的边界；主 Agent 保留决策、Git 和最终整合。');
  }
  const guidance = promptGuidance(input && input.prompt, config);
  if (guidance) lines.push(guidance);
  if (lines.length === 0) return;
  output({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n'),
    },
  });
}

main().catch(() => {});
