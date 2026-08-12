#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { readStdinJson, output, log } = require('./lib/utils');
const { loadConfig } = require('./lib/config');
const { blockedMarkerPath, hookCwd } = require('./lib/marker');
const {
  containsGitCommand,
  isWhitelistedTool,
  isWhitelistedMcp,
  isSafeBashCommand,
  isMcpBlocked,
} = require('./lib/rules');

/**
 * 构建通用 block 消息（中文短版，系统指令语气）
 * 不硬编码任何具体 MCP 插件名，适用于所有被拦截的工具
 */
function buildBlockMessage(toolName) {
  return `✨ 拦截：主 Agent 禁止直接调用 [${toolName}]，请派遣子代理执行！\n✨ 不论任务大小，"我自己做更快"不是例外。\n✨ 子代理修改文件后需在报告中列出路径，主 Agent 据此重读保持缓存一致。\n✨ 示例：Agent({ description: "...", prompt: "...改完后列出所有被修改的文件路径" })`;
}

/**
 * 写标记文件，供 prompt_inject 延迟激活使用
 */
function writeBlockMarker(input) {
  try { fs.writeFileSync(blockedMarkerPath(input), String(Date.now()), 'utf8'); } catch {}
}

function buildSubagentGitMessage() {
  return '✨ 拦截：Git 操作必须由主 Agent 串行执行，子代理不得运行 Git。\n' +
    '✨ 请回报所需 Git 操作、修改文件、验证结果和阻塞项，由主 Agent 处理。';
}

function denyTool(reason) {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    process.exit(0);
    return;
  }
  if (!input) { process.exit(0); return; }

  const cwd = hookCwd(input);
  const config = loadConfig(cwd);
  if (!config.modules.enforcer) { process.exit(0); return; }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Claude Code 会在子代理工具事件中提供 agent_id。子代理继续豁免普通工具，
  // 但 Git 始终留在主代理，避免分支、索引和提交操作并发冲突。
  if (input.agent_id) {
    if ((toolName === 'Bash' || toolName === 'PowerShell')
        && containsGitCommand(toolInput.command)) {
      denyTool(buildSubagentGitMessage());
    }
    process.exit(0);
    return;
  }

  // deny 优先：精确拦截名单中的工具，即使前缀白名单匹配也强制 block
  if (isMcpBlocked(toolName, config)) {
    log(`[agent-dispatch] HARD-BLOCKED (mcp_block_exact): ${toolName}`);
    writeBlockMarker(input);
    denyTool(buildBlockMessage(toolName));
    process.exit(0);
    return;
  }

  if (isWhitelistedTool(toolName, config)) { process.exit(0); return; }

  if (isWhitelistedMcp(toolName, config)) { process.exit(0); return; }

  if ((toolName === 'Bash' || toolName === 'PowerShell') && isSafeBashCommand(toolInput.command, config)) {
    process.exit(0);
    return;
  }

  log(`[agent-dispatch] BLOCKED: ${toolName}`);
  writeBlockMarker(input);
  denyTool(buildBlockMessage(toolName));
  process.exit(0);
}

main();
