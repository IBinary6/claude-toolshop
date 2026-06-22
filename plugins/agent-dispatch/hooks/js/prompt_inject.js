#!/usr/bin/env node
'use strict';

/**
 * ABOUTME: UserPromptSubmit Hook — 延迟激活 dispatcher 角色指令
 * ABOUTME: 仅在上次 block 后的下一条 prompt 注入一次，注入后立即删标记
 * ABOUTME: 由 config.modules.prompt_inject 控制总开关
 */

const fs = require('fs');
const { loadConfig } = require('./lib/config');
const { blockedMarkerPath, hookCwd } = require('./lib/marker');
const { readStdinJson } = require('./lib/utils');

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
  if (!isRecentlyBlocked(markerFile)) return;

  // 一次性触发：注入后立即删标记，避免后续每条 prompt 都注入
  try { fs.unlinkSync(markerFile); } catch {}

  const message = [
    '✨ 上次工具调用被拦截，继续当前任务请注意：',
    '✨ 不论任务大小，非白名单或高风险操作一律委派子代理，"自己做更快"不是例外。',
    '✨ 使用 Agent({ description, prompt }) 委派子代理',
    '✨ 子代理修改文件后需在报告中列出路径，主 Agent 据此重读保持缓存一致',
  ].join('\n');

  console.log(message);
}

main().catch(() => {});
