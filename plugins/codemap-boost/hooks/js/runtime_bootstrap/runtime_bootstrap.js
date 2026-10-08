#!/usr/bin/env node
// ABOUTME: SessionStart 钩子 - 私有 CRG / Serena 环境缺失时在后台安装，不阻塞会话启动
// ABOUTME: 只做文件存在性的快速检查；完整健康探针由 MCP 启动器和 ensure-runtime.cjs 负责

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const rt = require('../lib/managed_runtime');

/**
 * 判断两个私有环境的入口是否都已存在（快速检查，不执行 Python）。
 * @returns {boolean}
 * @example
 * installedQuick() // false：首次会话，需要后台安装
 */
function installedQuick() {
  return fs.existsSync(rt.crgPaths().command) && fs.existsSync(rt.serenaPaths().command);
}

function main() {
  try {
    if (installedQuick() || process.env.CODEMAP_BOOST_NO_BOOTSTRAP === '1') return;
    const script = path.join(__dirname, '..', '..', '..', 'scripts', 'ensure-runtime.cjs');
    const child = spawn(process.execPath, [script], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    });
    child.unref();
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: '[codemap-boost] 正在后台安装插件内置的 code-review-graph 与 Serena（首次约数分钟，需联网）。'
          + '完成前对应 MCP 工具可能暂不可用；就绪后运行 /mcp 重连即可，期间用 Grep/Read 等常规工具继续，不要自行 pip 安装。',
      },
    }));
  } catch (e) {
    // 静默：预装失败不影响会话，MCP 启动器会再次尝试并给出诊断
  }
}

main();
