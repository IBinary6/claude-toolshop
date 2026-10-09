'use strict';

const { spawnSync: defaultSpawnSync } = require('node:child_process');

const PYTHON3_PROBE = 'import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)';
const PYTHON_PROBE_TIMEOUT_MS = 3000;
let cachedPythonResolved = false;
let cachedPython = null;

/**
 * Split launch arguments from an environment variable into an argument array.
 *
 * @param {string|undefined} value Whitespace-separated argument text.
 * @returns {string[]} The launch arguments.
 * @example
 * splitArgs('-3 -X utf8') // ['-3', '-X', 'utf8']
 */
function splitArgs(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Build the Python candidates for the current platform; the Windows launcher uses `py -3` and does not pin a minor version.
 *
 * @param {{platform?:string, env?:object}} [options]
 * @returns {Array<{cmd:string,args:string[]}>} Candidates in probe order.
 * @example
 * pythonCandidates({ platform: 'win32', env: {} })
 */
function pythonCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (env.CPP_STYLE_PYTHON) {
    return [{ cmd: env.CPP_STYLE_PYTHON, args: splitArgs(env.CPP_STYLE_PYTHON_ARGS) }];
  }
  return platform === 'win32'
    ? [
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] },
      ]
    : [
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] },
      ];
}

/**
 * Verify that one launch descriptor can run Python 3; a missing command, a timeout or Python 2 all return false.
 *
 * @param {{cmd:string,args:string[]}} candidate The Python launch descriptor.
 * @param {{platform?:string, spawnSync?:Function}} [options]
 * @returns {boolean} Whether it is a runnable Python 3.
 * @example
 * probePython3({ cmd: 'python3', args: [] })
 */
function probePython3(candidate, options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawnSync || defaultSpawnSync;
  try {
    const result = spawn(candidate.cmd, [...candidate.args, '-c', PYTHON3_PROBE], {
      stdio: 'pipe',
      timeout: PYTHON_PROBE_TIMEOUT_MS,
      windowsHide: platform === 'win32',
    });
    return !result.error && result.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * Probe and return every runnable Python 3 launch descriptor; missing commands and Python 2 are skipped.
 *
 * @param {{platform?:string, env?:object, spawnSync?:Function, candidates?:Array<{cmd:string,args:string[]}>}} [options]
 * @returns {Array<{cmd:string,args:string[]}>} Candidates verified as Python 3.
 * @example
 * resolvePythonCandidates()[0] // { cmd: 'python3', args: [] }
 */
function resolvePythonCandidates(options = {}) {
  const candidates = options.candidates || pythonCandidates(options);
  return candidates.filter((candidate) => probePython3(candidate, options));
}

/**
 * Return the first verified Python 3 launch descriptor, or null when none is usable.
 *
 * @param {{platform?:string, env?:object, spawnSync?:Function, candidates?:Array<{cmd:string,args:string[]}>}} [options]
 * @returns {{cmd:string,args:string[]}|null} The Python 3 launch descriptor.
 * @example
 * const python = resolvePython();
 * if (python) console.log(python.cmd);
 */
function resolvePython(options = {}) {
  const useCache = options.useCache === true || Object.keys(options).length === 0;
  if (useCache && cachedPythonResolved) return cachedPython;
  const candidates = options.candidates || pythonCandidates(options);
  for (const candidate of candidates) {
    if (probePython3(candidate, options)) {
      if (useCache) {
        cachedPythonResolved = true;
        cachedPython = candidate;
      }
      return candidate;
    }
  }
  if (useCache) cachedPythonResolved = true;
  return null;
}

/**
 * Clear the in-process Python probe cache; for deterministic tests only.
 * @returns {void}
 */
function resetPythonCacheForTests() {
  cachedPythonResolved = false;
  cachedPython = null;
}

module.exports = {
  PYTHON3_PROBE,
  PYTHON_PROBE_TIMEOUT_MS,
  pythonCandidates,
  resetPythonCacheForTests,
  resolvePython,
  resolvePythonCandidates,
};
