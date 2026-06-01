#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readStdinJson, output, log } = require('./lib/utils');
const { loadConfig } = require('./lib/config');
const { isWhitelistedTool, isWhitelistedMcp, isSafeBashCommand, isMcpBlocked } = require('./lib/rules');

const MARKER_FILE = path.join(os.tmpdir(), '.agent-dispatch-blocked');

/**
 * 构建通用 block 消息（中文短版，系统指令语气）
 * 不硬编码任何具体 MCP 插件名，适用于所有被拦截的工具
 */
function buildBlockMessage(toolName) {
  return `🈲BLOCKED:主 agent禁止直接调用[${toolName}]，请派遣子代理执行。\n若子代理会修改文件，必须在返回报告中列出所有被改文件的路径，供主 agent 重读以保持缓存一致。\n示例:Agent({ description:"...", prompt:"...改完后列出所有被修改的文件路径" })`;
}

/**
 * 写标记文件，供 prompt_inject 延迟激活使用
 */
function writeBlockMarker() {
  try { fs.writeFileSync(MARKER_FILE, String(Date.now()), 'utf8'); } catch {}
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

  // subagent 豁免：拥有 agent_id 的调用不受拦截
  if (input.agent_id) { process.exit(0); return; }

  const config = loadConfig();
  if (!config.modules.enforcer) { process.exit(0); return; }

  const toolName = input.tool_name || '';

  // deny 优先：精确拦截名单中的工具，即使前缀白名单匹配也强制 block
  if (isMcpBlocked(toolName, config)) {
    log(`[agent-dispatch] HARD-BLOCKED (mcp_block_exact): ${toolName}`);
    writeBlockMarker();
    output({ decision: 'block', reason: buildBlockMessage(toolName) });
    process.exit(0);
    return;
  }

  if (isWhitelistedTool(toolName, config)) { process.exit(0); return; }

  if (isWhitelistedMcp(toolName, config)) { process.exit(0); return; }

  const toolInput = input.tool_input || {};
  if ((toolName === 'Bash' || toolName === 'PowerShell') && isSafeBashCommand(toolInput.command, config)) {
    process.exit(0);
    return;
  }

  log(`[agent-dispatch] BLOCKED: ${toolName}`);
  writeBlockMarker();
  output({ decision: 'block', reason: buildBlockMessage(toolName) });
  process.exit(0);
}

main();
