#!/usr/bin/env node
/**
 * codemap-pro 显式 setup 依赖 helper
 *
 * 职责:
 * 1. 检测 codegraph CLI 可用性
 * 2. 不可用 → 返回 false，等待 /codemap-pro-setup 经用户确认后安装
 * 3. MCP 配置由 /codemap-pro-setup 显式执行
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
    fs.mkdirSync(path.dirname(p), { recursive: true });
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
 * npm 全局安装 helper。
 *
 * 仅供 /codemap-pro-setup 显式流程使用；hook 不会调用它。
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
 * 检查 codegraph CLI 是否可用。
 *
 * 不安装依赖、不配置 MCP；hook 缺 CLI 时应静默跳过。
 *
 * @param {object} opts - 依赖注入选项（便于测试）
 * @returns {boolean} true=可用, false=不可用
 */
function ensureCodegraph(opts) {
  const o = opts || {};
  const probe = o.probe || probeCommand;

  let ok = false;
  try {
    ok = !!probe('codegraph');
  } catch (_) {
    ok = false;
  }
  return ok;
}

/**
 * 兼容旧调用的 no-op。
 *
 * 旧版本会从 hook 后台安装 CodeGraph；现在依赖安装必须由
 * /codemap-pro-setup 显式触发，因此这里固定返回 null。
 *
 * @returns {null}
 */
function spawnPrewarm() {
  return null;
}

// CLI 入口 - 兼容旧 --prewarm 入口。现在不做自动安装。
if (require.main === module && process.argv.includes('--prewarm')) {
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
