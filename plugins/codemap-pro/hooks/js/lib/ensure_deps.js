#!/usr/bin/env node
/**
 * codemap-pro 依赖自举 - npm/npx 检测与自动安装
 *
 * 职责:
 * 1. 检测 codegraph CLI 可用性
 * 2. 不可用 → 自动 npm install -g @colbymchenry/codegraph
 * 3. 安装成功 → 自动配置 MCP (codegraph install --target=claude --yes)
 * 4. 失败 → 写标记防重试
 *
 * 参考: codemap-boost/hooks/js/lib/ensure_deps.js (pip 自举模式)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isWindows = process.platform === 'win32';

/**
 * 失败标记目录 - 优先 CLAUDE_PLUGIN_DATA，回退 tmpdir
 * marketplace 通道下插件目录可能只读/被整体替换
 */
function markerDir() {
  return process.env.CLAUDE_PLUGIN_DATA || os.tmpdir();
}

function markerPath(name) {
  return path.join(markerDir(), name);
}

function markerExists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function writeMarker(p) {
  try {
    fs.writeFileSync(p, String(Date.now()), 'utf-8');
  } catch (_) {}
}

/**
 * 探测命令可用性 - 直接试跑 --version
 * 不用 where/which，避免 PATH 缓存问题
 */
function probeCommand(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], {
      stdio: 'ignore',
      timeout: 15000,
      windowsHide: isWindows
    });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * npm 全局安装
 * 超时 300s（首次安装可能较慢）
 */
function npmInstallGlobal(pkg) {
  try {
    const r = spawnSync('npm', ['install', '-g', pkg, '--no-audit', '--no-fund'], {
      stdio: 'ignore',
      timeout: 300000,
      windowsHide: isWindows
    });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 配置 MCP Server - codegraph install --target=claude --yes
 */
function configureMcp() {
  try {
    const r = spawnSync('codegraph', ['install', '--target=claude', '--yes'], {
      stdio: 'ignore',
      timeout: 30000,
      windowsHide: isWindows
    });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 确保 codegraph CLI 可用
 *
 * @param {object} opts - 依赖注入选项（便于测试）
 * @returns {boolean} true=可用, false=不可用
 */
function ensureCodegraph(opts) {
  const o = opts || {};
  const probe = o.probe || probeCommand;
  const install = o.install || npmInstallGlobal;
  const setupMcp = o.setupMcp || configureMcp;
  const marker = o.markerPath || markerPath('.codegraph-install-failed');

  // 1. 已可用 → 确保 MCP 已配置
  let ok = false;
  try {
    ok = !!probe('codegraph');
  } catch (_) {
    ok = false;
  }

  if (ok) {
    // 尝试配置 MCP（幂等，已配置会跳过）
    try {
      setupMcp();
    } catch (_) {}
    return true;
  }

  // 2. 曾失败 → 不重试
  if (markerExists(marker)) {
    return false;
  }

  // 3. 尝试安装
  let installed = false;
  try {
    installed = !!install('@colbymchenry/codegraph');
  } catch (_) {
    installed = false;
  }

  if (installed) {
    // 复检 CLI
    try {
      ok = !!probe('codegraph');
    } catch (_) {
      ok = false;
    }

    if (ok) {
      // 配置 MCP
      try {
        setupMcp();
      } catch (_) {}
      return true;
    }
  }

  // 4. 仍失败 → 写标记
  writeMarker(marker);
  return false;
}

/**
 * 后台预热安装 - detached 子进程
 *
 * 用法: SessionStart 时调用 spawnPrewarm()，立即返回
 * 子进程在后台安装，不阻塞会话启动
 */
function spawnPrewarm() {
  const { spawn } = require('child_process');

  const child = spawn(process.execPath, [__filename, '--prewarm'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: isWindows,
    env: process.env
  });

  child.unref();
  return child;
}

// CLI 入口 - 仅在 --prewarm 模式执行
if (require.main === module && process.argv.includes('--prewarm')) {
  // 静默预热，不输出任何内容
  ensureCodegraph();
  process.exit(0);
}

module.exports = {
  ensureCodegraph,
  spawnPrewarm,
  probeCommand,
  npmInstallGlobal,
  configureMcp,
  markerPath,
  markerExists,
  writeMarker
};
