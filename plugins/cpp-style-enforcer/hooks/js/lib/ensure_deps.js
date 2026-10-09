'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pythonCandidates, resolvePythonCandidates } = require('./python');

const isWindows = process.platform === 'win32';
const ICONV_LITE_SPEC = 'iconv-lite@0.6.3';
const CLANG_FORMAT_SPEC = 'clang-format==18.1.8';
// Plugin root: hooks/js/lib -> hooks/js -> hooks -> plugin root.
// Prefer CLAUDE_PLUGIN_ROOT injected by the hook runtime; when missing (for example tests run directly with node) fall back to a path relative to __dirname.
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..', '..');

/**
 * Persistent data directory (~/.claude/plugins/data/{id}/), injected by the hook runtime as CLAUDE_PLUGIN_DATA.
 * Missing (tests run directly with node, or an old host) -> null, and callers degrade accordingly.
 */
function pluginDataDir() {
  const d = process.env.CLAUDE_PLUGIN_DATA;
  return d ? d : null;
}

/**
 * Absolute path of a marker file (meaning "the install already failed, do not retry").
 * The install target is PLUGIN_DATA, so the failure marker also lives there (persistent and writable);
 * when PLUGIN_DATA is missing it falls back to the system temp dir so the marketplace plugin cache is not polluted and updates keep working.
 */
function markerPath(name) {
  const dataDir = pluginDataDir();
  return path.join(dataDir || path.join(os.tmpdir(), 'cpp-style-enforcer'), name);
}

/** Safe check: does the marker file exist? */
function markerExists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}

/** Write a marker safely; failures are silent. */
function writeMarker(p) {
  try {
    if (!p) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '1');
  } catch (_) {}
}

/**
 * Install iconv-lite into the persistent data directory PLUGIN_DATA (not the plugin root).
 * Why: the marketplace bundle channel strips the packaged node_modules, the plugin directory is replaced wholesale on every update,
 * and it may be read-only; PLUGIN_DATA is persistent and writable. PLUGIN_DATA missing -> skip the install and return false (do not crash).
 * Uses `npm install <pkg> --prefix <dataDir>`; the dependency name is hard-coded to match package.json.
 */
function npmInstall() {
  const dataDir = pluginDataDir();
  if (!dataDir) return false; // No persistent directory -> do not install (degrade, do not crash)
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (_) {}
  try {
    const r = spawnSync(
      isWindows ? 'npm.cmd' : 'npm',
      ['install', ICONV_LITE_SPEC, '--no-audit', '--no-fund', '--no-save', '--prefix', dataDir],
      { cwd: dataDir, stdio: 'ignore', timeout: 60000, windowsHide: isWindows }
    );
    return !r.error && r.status === 0;
  } catch (_) {
    return false;
  }
}

/** Default: pip-install clang-format (relies on python, the most reliable cross-platform route). */
function pipInstallClangFormat() {
  for (const py of resolvePythonCandidates()) {
    try {
      const r = spawnSync(
        py.cmd,
        [...py.args, '-m', 'pip', 'install', '--disable-pip-version-check', CLANG_FORMAT_SPEC],
        { stdio: 'ignore', timeout: 120000, windowsHide: isWindows }
      );
      if (!r.error && r.status === 0) return true;
    } catch (_) {}
  }
  return false;
}

/**
 * Default probe: try running `<cmd> [...args] --version` to see whether an invocation descriptor works.
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
 * Default: candidate absolute paths of the clang-format executable in the Scripts directory of verified Python 3 launchers.
 * Entry scripts installed by pip often land there and may not be on PATH. Failures silently return [].
 * @returns {Array<{cmd:string, args:string[]}>}
 */
function scriptsDirCandidates() {
  const out = [];
  for (const py of resolvePythonCandidates()) {
    let dir = null;
    try {
      const r = spawnSync(py.cmd, [...py.args, '-c', "import sysconfig; print(sysconfig.get_path('scripts'))"],
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
 * Default: find a usable way to call clang-format in order and return the invocation descriptor {cmd, args}; null when none is found.
 * Order: 1) clang-format on PATH  2) the pip package module entry python -m clang_format (Python 3 only)
 *        3) the clang-format executable in the python Scripts directory.
 *
 * @param {object} [opts]
 * @param {function({cmd:string,args:string[]}):boolean} [opts.probe] Injected probe function (for tests).
 * @param {function():Array<{cmd:string,args:string[]}>} [opts.scriptsDirs] Injected Scripts-directory candidate generator (for tests).
 * @param {function():Array<{cmd:string,args:string[]}>} [opts.pythons] Injected verified Python 3 candidates (for tests).
 * @returns {{cmd:string, args:string[]}|null}
 */
function detectClangFormat(opts) {
  const o = opts || {};
  const probe = o.probe || probeClangFormat;
  const scriptsDirs = o.scriptsDirs || scriptsDirCandidates;
  const pythons = o.pythons || resolvePythonCandidates;

  const candidates = [
    { cmd: 'clang-format', args: [] },
    ...pythons().map((py) => ({ cmd: py.cmd, args: [...py.args, '-m', 'clang_format'] })),
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
 * Resolve a module's absolute entry path in "belt and braces" order; returns null when not found.
 * Order: (a) ${CLAUDE_PLUGIN_ROOT}/node_modules/<name> (bundled, works straight away for local/git installs)
 *        (b) ${CLAUDE_PLUGIN_DATA}/node_modules/<name> (fallback, installed on demand)
 * Uses require.resolve(paths) so Node resolves inside the given directory trees. Never throws.
 * @param {string} name Module name.
 * @returns {string|null} The resolved entry path.
 */
function resolveModulePath(name) {
  const roots = [];
  if (PLUGIN_ROOT) roots.push(PLUGIN_ROOT);
  const dataDir = pluginDataDir();
  if (dataDir) roots.push(dataDir);
  for (const r of roots) {
    try {
      return require.resolve(name, { paths: [r] });
    } catch (_) {}
  }
  return null;
}

let _iconvCache; // undefined = not resolved yet; null = confirmed unavailable; object = the module
/**
 * Resolve the iconv-lite module (belt and braces: ROOT then DATA). Resolve only, never install; the result is cached.
 * Used by the frequently called bom_util: lightweight and spawns no child process. Returns null when not found (GBK degrades).
 * @returns {object|null}
 */
function requireIconv() {
  if (_iconvCache !== undefined) return _iconvCache;
  const p = resolveModulePath('iconv-lite');
  let mod = null;
  if (p) {
    try { mod = require(p); } catch (_) { mod = null; }
  }
  _iconvCache = mod;
  return mod;
}

/**
 * Resolve iconv-lite. At run time it only detects by default; with an explicit allowInstall it installs once into PLUGIN_DATA.
 * Still failing -> write a failure marker and return null (degrade: GBK files are skipped). Never throws.
 *
 * Resolution is belt and braces: the default module name goes through requireIconv (ROOT -> DATA); an injected moduleName is resolved by that name (for tests).
 *
 * @param {object} [opts]
 * @param {string} [opts.moduleName] Injected for tests; by default requireIconv's belt-and-braces resolution is used.
 * @param {string} [opts.marker] Failure marker path; defaults to .iconv-install-failed under PLUGIN_DATA (or the plugin root).
 * @param {boolean} [opts.allowInstall] Explicitly allow installing; do not enable on ordinary hook paths.
 * @param {function():boolean} [opts.install] Injected install function; defaults to npmInstall (installs into PLUGIN_DATA).
 * @returns {object|null}
 */
function ensureIconvLite(opts) {
  const o = opts || {};
  const marker = o.marker || markerPath('.iconv-install-failed');
  const allowInstall = o.allowInstall === true;
  const install = o.install || npmInstall;

  // An injected moduleName is resolved by that name (for tests, can simulate "missing"); otherwise use belt-and-braces path resolution.
  const tryRequire = o.moduleName
    ? () => { try { return require(o.moduleName); } catch (_) { return null; } }
    : () => requireIconv();

  const found = tryRequire();
  if (found) return found;                 // Already installed -> do not trigger an install
  if (markerExists(marker)) return null;    // Failed before -> do not retry
  if (!allowInstall) return null;           // Run time only detects; never installs inside a hook

  let ok = false;
  try { ok = !!install(); } catch (_) { ok = false; }
  if (ok) {
    // Clear the cache and re-resolve after installing (PLUGIN_DATA was just populated)
    _iconvCache = undefined;
    const after = tryRequire();
    if (after) return after;
  }
  writeMarker(marker);
  return null;
}

/**
 * Resolve clang-format. At run time it only detects by default; with an explicit allowInstall it pip-installs once.
 * Still not detected -> write a failure marker and return null (degrade: clang-format is skipped). Never throws.
 *
 * @param {object} [opts]
 * @param {function():({cmd:string,args:string[]}|null)} [opts.detect] Injected detector; defaults to detectClangFormat.
 * @param {string} [opts.marker] Failure marker path; defaults to .clang-format-install-failed under the plugin root.
 * @param {boolean} [opts.allowInstall] Explicitly allow installing; do not enable on ordinary hook paths.
 * @param {function():boolean} [opts.install] Injected install function; defaults to pipInstallClangFormat.
 * @returns {{cmd:string, args:string[]}|null}
 */
function ensureClangFormat(opts) {
  const o = opts || {};
  const marker = o.marker || markerPath('.clang-format-install-failed');
  const detect = o.detect || detectClangFormat;
  const allowInstall = o.allowInstall === true;
  const install = o.install || pipInstallClangFormat;

  let desc = null;
  try { desc = detect(); } catch (_) { desc = null; }
  if (desc) return desc;                      // Already usable -> do not trigger an install
  if (markerExists(marker)) return null;      // Failed before -> do not retry
  if (!allowInstall) return null;             // Run time only detects; never installs inside a hook

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
 * No-op kept for older tests/callers. The passive SessionStart no longer installs dependencies in the background.
 * @returns {null}
 */
function spawnPrewarm() {
  return null;
}

module.exports = {
  ensureIconvLite,
  ensureClangFormat,
  markerPath,
  spawnPrewarm,
  detectClangFormat,
  requireIconv,
  pythonCandidates,
};

// CLI: manual prewarm entry. Only installs/detects and never prints anything.
if (require.main === module && process.argv.includes('--prewarm')) {
  try { ensureIconvLite({ allowInstall: true }); } catch (_) {}
  try { ensureClangFormat({ allowInstall: true }); } catch (_) {}
  process.exit(0);
}
