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

/**
 * 默认探测：以 `<cmd> [...args] --version` 试跑一个调用描述是否可用。
 * @param {{cmd:string, args:string[]}} desc
 * @returns {boolean}
 */
function probeClangFormat(desc) {
  try {
    const r = spawnSync(desc.cmd, [...desc.args, '--version'], { stdio: 'ignore', timeout: 10000, windowsHide: isWindows });
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 默认：拿 python(/python3) 的 Scripts 目录里 clang-format 可执行的绝对路径候选。
 * pip 安装的入口脚本常落在此目录，可能不在 PATH。失败静默返回 []。
 * @returns {Array<{cmd:string, args:string[]}>}
 */
function scriptsDirCandidates() {
  const out = [];
  for (const py of ['python', 'python3']) {
    let dir = null;
    try {
      const r = spawnSync(py, ['-c', "import sysconfig; print(sysconfig.get_path('scripts'))"],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: isWindows });
      if (!r.error && r.status === 0 && r.stdout) dir = String(r.stdout).trim();
    } catch (_) {}
    if (!dir) continue;
    for (const exe of isWindows ? ['clang-format.exe', 'clang-format'] : ['clang-format']) {
      const p = path.join(dir, exe);
      try { if (fs.existsSync(p)) out.push({ cmd: p, args: [] }); } catch (_) {}
    }
  }
  return out;
}

/**
 * 默认：按顺序找出可用的 clang-format 调用方式，返回调用描述 {cmd, args}，找不到返回 null。
 * 顺序：1) PATH 的 clang-format  2) pip 包模块入口 python -m clang_format(python/python3)
 *      3) python Scripts 目录下的 clang-format 可执行。
 *
 * @param {object} [opts]
 * @param {function({cmd:string,args:string[]}):boolean} [opts.probe] 注入探测函数（测试用）
 * @param {function():Array<{cmd:string,args:string[]}>} [opts.scriptsDirs] 注入 Scripts 候选生成（测试用）
 * @returns {{cmd:string, args:string[]}|null}
 */
function detectClangFormat(opts) {
  const o = opts || {};
  const probe = o.probe || probeClangFormat;
  const scriptsDirs = o.scriptsDirs || scriptsDirCandidates;

  const candidates = [
    { cmd: 'clang-format', args: [] },
    { cmd: 'python', args: ['-m', 'clang_format'] },
    { cmd: 'python3', args: ['-m', 'clang_format'] },
  ];
  for (const desc of candidates) {
    try { if (probe(desc)) return desc; } catch (_) {}
  }
  let extra = [];
  try { extra = scriptsDirs() || []; } catch (_) { extra = []; }
  for (const desc of extra) {
    try { if (probe(desc)) return desc; } catch (_) {}
  }
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
 * 按需自举 clang-format。检测到可用直接返回调用描述；缺失且未尝试过 → pip 安装一次；
 * 仍检测不到 → 写失败标记并返回 null（降级：clang-format 跳过）。全程不抛。
 *
 * @param {object} [opts]
 * @param {function():({cmd:string,args:string[]}|null)} [opts.detect] 注入检测函数，缺省 detectClangFormat
 * @param {string} [opts.marker] 失败标记路径，缺省插件根 .clang-format-install-failed
 * @param {function():boolean} [opts.install] 注入安装函数，缺省 pipInstallClangFormat
 * @returns {{cmd:string, args:string[]}|null}
 */
function ensureClangFormat(opts) {
  const o = opts || {};
  const marker = o.marker || markerPath('.clang-format-install-failed');
  const detect = o.detect || detectClangFormat;
  const install = o.install || pipInstallClangFormat;

  let desc = null;
  try { desc = detect(); } catch (_) { desc = null; }
  if (desc) return desc;                      // 已可用 → 不触发安装
  if (markerExists(marker)) return null;      // 曾失败 → 不重试

  let ok = false;
  try { ok = !!install(); } catch (_) { ok = false; }
  if (ok) {
    try { desc = detect(); } catch (_) { desc = null; }
    if (desc) return desc;
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
