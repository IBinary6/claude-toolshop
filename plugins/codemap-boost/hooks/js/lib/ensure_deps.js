'use strict';
// ABOUTME: codemap-boost 依赖自举 — 缺 code-review-graph / graphify 时 pip 自动装。
// ABOUTME: 两者都是 pip CLI（装到用户级 python 环境，无 node_modules 问题）。
//
// 设计要点（参考 cpp-style-enforcer 的 ensure_deps）：
//   - 检测命令是否可用（commandExists 或 `<cmd> --version` 试跑）。
//   - 缺失且未失败过 → `python -m pip install <pkg>`（python 回退 python3）。
//   - 包名：code-review-graph → pip 包 `code-review-graph`；
//           graphify 命令     → pip 包 `graphifyy`（注意双 y）。
//   - 失败写标记防重复装（落 PLUGIN_DATA，缺失回退 os.tmpdir）。
//   - python 缺失则无法 pip → 跳过返回 false（前置之一就是 python ≥3.10）。
//   - 全程不抛，失败安全降级返回 false。
//   - 安装时机：SessionStart 后台 detached 预热（spawnPrewarm），不阻塞、不超时。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const isWindows = process.platform === 'win32';

/**
 * 失败标记目录：优先 PLUGIN_DATA（持久、可写），缺失回退 os.tmpdir。
 * 不用插件根：marketplace 通道下插件目录每次更新整体替换、可能只读。
 */
function markerDir() {
  return process.env.CLAUDE_PLUGIN_DATA || os.tmpdir();
}

/** 标记文件绝对路径 */
function markerPath(name) {
  return path.join(markerDir(), name);
}

/** 安全检测：标记文件是否存在 */
function markerExists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}

/** 安全写标记，失败静默 */
function writeMarker(p) {
  try {
    if (!p) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '1');
  } catch (_) {}
}

/**
 * 探测命令是否可用：试跑 `<cmd> --version`。
 * 不用 PATH 的 where/which（pip 装的入口脚本可能晚于本进程 PATH 缓存），
 * 直接试跑最可靠。失败/抛出都返回 false。
 * @param {string} cmd
 * @returns {boolean}
 */
function probeCommand(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15000, windowsHide: isWindows });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 用 `python -m pip install <pkg>` 安装；python 失败回退 python3。
 * python 都不可用（前置缺失）→ 返回 false（降级，不崩）。
 * @param {string} pkg pip 包名
 * @returns {boolean} 是否有解释器跑成功（status 0）
 */
function pipInstall(pkg) {
  for (const py of ['python', 'python3']) {
    try {
      const r = spawnSync(
        py,
        ['-m', 'pip', 'install', '--disable-pip-version-check', pkg],
        { stdio: 'ignore', timeout: 300000, windowsHide: isWindows }
      );
      if (!r.error && r.status === 0) return true;
    } catch (_) {}
  }
  return false;
}

/**
 * 通用自举：检测命令 → 缺失且未失败过则 pip 装一次 → 复检 → 仍失败写标记返回 false。
 * @param {object} args
 * @param {string} args.cmd      要检测的 CLI 命令名
 * @param {string} args.pkg      对应 pip 包名
 * @param {string} args.marker   失败标记文件名
 * @param {object} [opts]        依赖注入（测试用）
 * @param {function(string):boolean} [opts.probe]   缺省 probeCommand
 * @param {function(string):boolean} [opts.install] 缺省 pipInstall
 * @param {string} [opts.markerPath] 缺省 markerPath(marker)
 * @returns {boolean} 命令最终是否可用
 */
function ensureCli(args, opts) {
  const o = opts || {};
  const probe = o.probe || probeCommand;
  const install = o.install || pipInstall;
  const marker = o.markerPath || markerPath(args.marker);

  let ok = false;
  try { ok = !!probe(args.cmd); } catch (_) { ok = false; }
  if (ok) return true;                       // 已可用 → 不触发安装
  if (markerExists(marker)) return false;    // 曾失败 → 不重试

  let installed = false;
  try { installed = !!install(args.pkg); } catch (_) { installed = false; }
  if (installed) {
    try { ok = !!probe(args.cmd); } catch (_) { ok = false; }
    if (ok) return true;
  }
  writeMarker(marker);
  return false;
}

/**
 * 自举 code-review-graph（pip 包名同命令名 code-review-graph）。
 * @param {object} [opts] 依赖注入（测试用）
 * @returns {boolean}
 */
function ensureCrg(opts) {
  return ensureCli(
    { cmd: 'code-review-graph', pkg: 'code-review-graph[all]', marker: '.crg-install-failed' },
    opts
  );
}

/**
 * 自举 graphify（命令名 graphify，pip 包名 graphifyy — 注意双 y）。
 * @param {object} [opts] 依赖注入（测试用）
 * @returns {boolean}
 */
function ensureGraphify(opts) {
  return ensureCli(
    { cmd: 'graphify', pkg: 'graphifyy', marker: '.graphify-install-failed' },
    opts
  );
}

/**
 * 后台 detached 预热子进程：跑本模块 CLI（--prewarm 分支）执行两个 ensure。
 * 立即返回不阻塞调用方；子进程 unref 后独立存活；输出全部丢弃保持静默。
 * spawn 失败不抛，返回 null。
 * @returns {import('child_process').ChildProcess|null}
 */
function spawnPrewarm() {
  try {
    const child = spawn(process.execPath, [__filename, '--prewarm'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: isWindows,
      env: process.env,
    });
    child.unref();
    return child;
  } catch (_) {
    return null;
  }
}

module.exports = {
  ensureCrg,
  ensureGraphify,
  ensureCli,
  probeCommand,
  pipInstall,
  markerPath,
  spawnPrewarm,
};

// CLI: 后台预热入口。仅做安装/检测，绝不输出。
if (require.main === module && process.argv.includes('--prewarm')) {
  try { ensureCrg(); } catch (_) {}
  try { ensureGraphify(); } catch (_) {}
  process.exit(0);
}
