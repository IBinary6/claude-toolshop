'use strict';

// ABOUTME: 插件私有的 code-review-graph / Serena 运行环境：装在 CLAUDE_PLUGIN_DATA 下的独立 venv，
// ABOUTME: 由 .mcp.json 的启动器与 hook 共用，不依赖用户级 MCP 注册或全局 pip。

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const PLUGIN_ID = 'codemap-boost';
// 不带 embeddings：serve 启动会无条件预热 sentence-transformers（13-27s，逼近 MCP 30s 启动超时），
// 而 hook 与提示从不调用 embed_graph；语义搜索在无向量时退化为 FTS 关键词。
const CRG_PACKAGE = 'code-review-graph[communities]';
const SERENA_VERSION = '1.7.0';
const SERENA_PACKAGE = `serena-agent==${SERENA_VERSION}`;
const PYTHON_VERSION = process.env.CODEMAP_BOOST_PYTHON_VERSION || '3.12';
const INSTALL_STEP_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_LOCK_WAIT_MS = 9 * 60 * 1000;
const INSTALL_LOCK_BOOT_MS = 5000;

/**
 * 插件数据目录：优先 Claude Code 注入的 CLAUDE_PLUGIN_DATA；手动安装时回退到 ~/.claude/plugins/data。
 * @returns {string}
 * @example
 * dataDir() // '~/.claude/plugins/data/codemap-boost-claude-toolshop'
 */
function dataDir() {
  const injected = process.env.CLAUDE_PLUGIN_DATA;
  return path.resolve(injected || path.join(os.homedir(), '.claude', 'plugins', 'data', PLUGIN_ID));
}

function venvPaths(name, command) {
  const dir = path.join(dataDir(), name);
  const bin = path.join(dir, isWindows ? 'Scripts' : 'bin');
  return {
    dir,
    python: path.join(bin, isWindows ? 'python.exe' : 'python'),
    command: path.join(bin, isWindows ? `${command}.exe` : command),
  };
}

/** CRG 私有 venv 路径。@example crgPaths().command */
function crgPaths() { return venvPaths('crg-runtime', 'code-review-graph'); }

/** Serena 私有 venv 路径（按版本隔离，升级固定版本时不原地改写）。@example serenaPaths().command */
function serenaPaths() {
  const base = venvPaths(path.join('serena-runtime', SERENA_VERSION), 'serena');
  return { ...base, home: path.join(dataDir(), 'serena-home') };
}

/**
 * hook 调用 CRG CLI 用的命令：私有环境已装好则用它，否则回退 PATH 上的 code-review-graph。
 * @returns {string}
 * @example
 * spawnSync(crgCommand(), ['status', '--repo', cwd])
 */
function crgCommand() {
  const managed = crgPaths().command;
  return fs.existsSync(managed) ? managed : 'code-review-graph';
}

function run(command, args, timeout) {
  try {
    const r = spawnSync(command, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, windowsHide: isWindows,
    });
    return !!r && !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

function hasCommand(cmd) {
  try {
    const r = spawnSync(isWindows ? 'where' : 'which', [cmd], { stdio: 'ignore', windowsHide: isWindows, timeout: 10000 });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/** 系统 Python 候选；CODEMAP_BOOST_PYTHON 可显式指定。 */
function pythonCandidates() {
  const list = [];
  if (process.env.CODEMAP_BOOST_PYTHON) {
    list.push([process.env.CODEMAP_BOOST_PYTHON, (process.env.CODEMAP_BOOST_PYTHON_ARGS || '').trim().split(/\s+/).filter(Boolean)]);
  }
  if (isWindows) list.push(['py', ['-3.12']], ['py', ['-3.11']]);
  list.push(['python3.12', []], ['python3.11', []], ['python', []], ['python3', []]);
  if (isWindows) list.push(['py', ['-3']]);
  return list;
}

/** 验证 CRG：CLI 可运行且 Python/JS/TS/TSX 解析器可加载（-I -B 不写 pycache）。 */
function probeCrg() {
  const p = crgPaths();
  if (!fs.existsSync(p.python) || !fs.existsSync(p.command)) return false;
  if (!run(p.command, ['--version'], 15000)) return false;
  const script = ['from tree_sitter_language_pack import get_parser',
    "for g in ('python', 'javascript', 'typescript', 'tsx'):", '    get_parser(g)'].join('\n');
  return run(p.python, ['-I', '-B', '-c', script], 15000);
}

/** 验证 Serena：固定版本与 CLI 入口可导入。 */
function probeSerena() {
  const p = serenaPaths();
  if (!fs.existsSync(p.python) || !fs.existsSync(p.command)) return false;
  const script = ['import sys', 'from importlib.metadata import version',
    'assert (3, 11) <= sys.version_info[:2] < (3, 15), sys.version',
    `assert version('serena-agent') == '${SERENA_VERSION}', version('serena-agent')`,
    'from serena.cli import top_level'].join('; ');
  return run(p.python, ['-I', '-B', '-c', script], 15000);
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}

/** 同一 venv 同时只允许一个进程安装；活进程持有的锁不会被抢。 */
function acquireLock(file, waitMs = INSTALL_LOCK_WAIT_MS) {
  const deadline = Date.now() + waitMs;
  const token = crypto.randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  while (Date.now() <= deadline) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      return token;
    } catch (e) {
      if (e.code !== 'EEXIST') return null;
    }
    try {
      const pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid) || 0;
      if (!pidAlive(pid) && Date.now() - fs.statSync(file).mtimeMs > INSTALL_LOCK_BOOT_MS) {
        fs.rmSync(file, { force: true });
        continue;
      }
    } catch (_) {}
    sleepSync(100);
  }
  return null;
}

function releaseLock(file, token) {
  try {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.rmSync(file, { force: true });
  } catch (_) {}
}

/** 重建隔离 venv 并安装 pkg：优先 uv，其次系统 Python 的 venv + pip；任何失败都清理半成品。 */
function installInto(paths, pkg, probe) {
  fs.rmSync(paths.dir, { recursive: true, force: true });
  if (hasCommand('uv')) {
    if (run('uv', ['venv', '--python', PYTHON_VERSION, paths.dir], INSTALL_STEP_TIMEOUT_MS)
        && run('uv', ['pip', 'install', '--python', paths.python, '--upgrade', pkg], INSTALL_STEP_TIMEOUT_MS)
        && probe()) return true;
    fs.rmSync(paths.dir, { recursive: true, force: true });
  }
  for (const [python, base] of pythonCandidates()) {
    if (!run(python, [...base, '-m', 'venv', paths.dir], INSTALL_STEP_TIMEOUT_MS) || !fs.existsSync(paths.python)) {
      fs.rmSync(paths.dir, { recursive: true, force: true });
      continue;
    }
    if (run(paths.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', pkg], INSTALL_STEP_TIMEOUT_MS)
        && probe()) return true;
    fs.rmSync(paths.dir, { recursive: true, force: true });
  }
  return false;
}

function failureMarker(name) { return path.join(dataDir(), name); }

function ensure(paths, pkg, probe, marker) {
  if (probe()) {
    fs.rmSync(failureMarker(marker), { force: true });
    return true;
  }
  const lockFile = `${paths.dir}.install.lock`;
  const token = acquireLock(lockFile);
  let ok = false;
  try {
    // 等锁期间别的进程可能已装好，先复查再重建。
    ok = probe() || (token !== null && installInto(paths, pkg, probe));
  } finally {
    if (token) releaseLock(lockFile, token);
  }
  try {
    if (ok) fs.rmSync(failureMarker(marker), { force: true });
    else {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(failureMarker(marker),
        `${pkg} 私有运行环境安装或健康检查失败。需要联网，以及 uv 或 Python 3.11+；`
        + '可设置 CODEMAP_BOOST_PYTHON 指定解释器后重启会话。\n', 'utf8');
    }
  } catch (_) {}
  return ok;
}

/** 确保 CRG 私有环境健康。@example ensureCrg() */
function ensureCrg() { return ensure(crgPaths(), CRG_PACKAGE, probeCrg, '.crg-install-failed'); }

/** 确保 Serena 私有环境健康。@example ensureSerena() */
function ensureSerena() { return ensure(serenaPaths(), SERENA_PACKAGE, probeSerena, '.serena-install-failed'); }

/** 读取上次安装失败的诊断文本，没有则返回空串。@example readFailure('.crg-install-failed') */
function readFailure(name) {
  try { return fs.readFileSync(failureMarker(name), 'utf8').trim(); } catch (_) { return ''; }
}

/** Serena MCP 的启动参数：关闭 dashboard / 浏览器 / GUI，context 用 claude-code。 */
const SERENA_MCP_ARGS = ['start-mcp-server', '--context', 'claude-code', '--project-from-cwd',
  '--enable-web-dashboard', 'false', '--open-web-dashboard', 'false', '--enable-gui-log-window', 'false'];

module.exports = {
  CRG_PACKAGE, SERENA_MCP_ARGS, SERENA_PACKAGE, SERENA_VERSION,
  crgCommand, crgPaths, dataDir, ensureCrg, ensureSerena, probeCrg, probeSerena, readFailure, serenaPaths,
};
