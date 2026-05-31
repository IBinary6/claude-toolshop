'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const isWindows = process.platform === 'win32';
// 插件根：hooks/js/lib → hooks/js → hooks → 插件根
const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');

/** 插件目录下的标记文件绝对路径（用于“安装已失败、勿重试”） */
function markerPath(name) {
  return path.join(PLUGIN_ROOT, name);
}

/** 安全检测：标记文件是否存在 */
function markerExists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}

/** 安全写标记，失败静默 */
function writeMarker(p) {
  try { if (p) fs.writeFileSync(p, '1'); } catch (_) {}
}

/** 默认：在插件根安装 package.json 声明的 npm 依赖（含 iconv-lite） */
function npmInstall() {
  try {
    const r = spawnSync(
      isWindows ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund', '--prefix', PLUGIN_ROOT],
      { cwd: PLUGIN_ROOT, stdio: 'ignore', timeout: 60000, windowsHide: isWindows }
    );
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/** 默认：pip 安装 clang-format（靠 python，跨平台最稳） */
function pipInstallClangFormat() {
  for (const py of ['python', 'python3']) {
    try {
      const r = spawnSync(
        py,
        ['-m', 'pip', 'install', '--disable-pip-version-check', 'clang-format'],
        { stdio: 'ignore', timeout: 120000, windowsHide: isWindows }
      );
      if (!r.error && r.status === 0) return true;
    } catch (_) {}
  }
  return false;
}

/** 默认：找出可用的 clang-format 调用方式，找不到返回 null */
function detectClangFormat() {
  // 1) PATH 里的 clang-format
  try {
    const r = spawnSync('clang-format', ['--version'], { stdio: 'ignore', timeout: 10000, windowsHide: isWindows });
    if (!r.error && r.status === 0) return 'clang-format';
  } catch (_) {}
  return null;
}

/**
 * 按需自举 iconv-lite。已装直接返回模块；缺失且未尝试过 → 安装一次；
 * 仍失败 → 写失败标记并返回 null（降级：GBK 跳过）。全程不抛。
 *
 * @param {object} [opts]
 * @param {string} [opts.moduleName='iconv-lite'] 注入测试用
 * @param {string} [opts.marker] 失败标记路径，缺省插件根 .iconv-install-failed
 * @param {function():boolean} [opts.install] 注入安装函数，缺省 npmInstall
 * @returns {object|null}
 */
function ensureIconvLite(opts) {
  const o = opts || {};
  const moduleName = o.moduleName || 'iconv-lite';
  const marker = o.marker || markerPath('.iconv-install-failed');
  const install = o.install || npmInstall;

  const tryRequire = () => { try { return require(moduleName); } catch (_) { return null; } };

  const found = tryRequire();
  if (found) return found;                 // 已装 → 不触发安装
  if (markerExists(marker)) return null;    // 曾失败 → 不重试

  let ok = false;
  try { ok = !!install(); } catch (_) { ok = false; }
  if (ok) {
    const after = tryRequire();
    if (after) return after;
  }
  writeMarker(marker);
  return null;
}

/**
 * 按需自举 clang-format。检测到可用直接返回命令名；缺失且未尝试过 → pip 安装一次；
 * 仍检测不到 → 写失败标记并返回 null（降级：clang-format 跳过）。全程不抛。
 *
 * @param {object} [opts]
 * @param {function():(string|null)} [opts.detect] 注入检测函数，缺省 detectClangFormat
 * @param {string} [opts.marker] 失败标记路径，缺省插件根 .clang-format-install-failed
 * @param {function():boolean} [opts.install] 注入安装函数，缺省 pipInstallClangFormat
 * @returns {string|null}
 */
function ensureClangFormat(opts) {
  const o = opts || {};
  const marker = o.marker || markerPath('.clang-format-install-failed');
  const detect = o.detect || detectClangFormat;
  const install = o.install || pipInstallClangFormat;

  let cmd = null;
  try { cmd = detect(); } catch (_) { cmd = null; }
  if (cmd) return cmd;                       // 已可用 → 不触发安装
  if (markerExists(marker)) return null;      // 曾失败 → 不重试

  let ok = false;
  try { ok = !!install(); } catch (_) { ok = false; }
  if (ok) {
    try { cmd = detect(); } catch (_) { cmd = null; }
    if (cmd) return cmd;
  }
  writeMarker(marker);
  return null;
}

/**
 * 后台 detached 预热子进程：跑本模块 CLI（prewarm 分支）执行两个 ensure。
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
    });
    child.unref();
    return child;
  } catch (_) {
    return null;
  }
}

module.exports = {
  ensureIconvLite,
  ensureClangFormat,
  markerPath,
  spawnPrewarm,
  detectClangFormat,
};

// CLI: 后台预热入口。仅做安装/检测，绝不输出。
if (require.main === module && process.argv.includes('--prewarm')) {
  try { ensureIconvLite(); } catch (_) {}
  try { ensureClangFormat(); } catch (_) {}
  process.exit(0);
}
