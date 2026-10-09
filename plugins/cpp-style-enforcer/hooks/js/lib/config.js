'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Hard-coded safe defaults, used when the global template and project config are missing or corrupt. */
const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'incremental',
  lineEnding: 'preserve',
  checks: { clangFormat: true, cpplint: true, bom: true },
  legacyChecks: { clangFormat: false, cpplint: false, bom: false },
};

/**
 * Default path of the global template: `~/.claude/cpp-style-template.json`.
 * @returns {string}
 * @example
 * userTemplatePath() // '/home/me/.claude/cpp-style-template.json'
 */
function userTemplatePath() {
  return path.join(os.homedir(), '.claude', 'cpp-style-template.json');
}

/**
 * Copy the factory template to the user's global template only when it does not exist yet;
 * an existing template is never overwritten. Copy failures are swallowed.
 * @param {string} defaultPath Absolute path of the plugin's factory template.
 * @param {string} [userPath] User template path (default `~/.claude/cpp-style-template.json`).
 * @returns {string} The user template path.
 * @example
 * ensureUserTemplate('/plugin/templates/cpp-style-template.default.json');
 */
function ensureUserTemplate(defaultPath, userPath = userTemplatePath()) {
  try {
    if (fs.existsSync(userPath)) return userPath;
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.copyFileSync(defaultPath, userPath);
  } catch (_) {
    // Permission problems or a missing source: fall back to the hard-coded defaults.
  }
  return userPath;
}

/** Read a JSON file safely; returns null on any failure. */
function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

/** Walk up from the edited file looking for `.claude-cpp-style/cpp-style.json`; null when not found. */
function findProjectConfig(filePath) {
  try {
    let dir = path.dirname(path.resolve(filePath));
    let prev = null;
    while (dir && dir !== prev) {
      const candidate = path.join(dir, '.claude-cpp-style', 'cpp-style.json');
      if (fs.existsSync(candidate)) return candidate;
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch (_) {}
  return null;
}

/**
 * Normalize by merging field by field: `base` first, then `override`.
 * Unknown keys (for example the removed `copyright` / `copyrightInfo`) are ignored.
 */
function normalize(base, override) {
  const merged = { ...DEFAULT_CONFIG, ...base, ...override };
  const checksIn = { ...DEFAULT_CONFIG.checks, ...(base && base.checks), ...(override && override.checks) };
  const checks = {
    clangFormat: checksIn.clangFormat !== false,
    cpplint: checksIn.cpplint !== false,
    bom: checksIn.bom !== false,
  };
  // legacyChecks are the per-check switches for tracked (old) files. Everything is off by default
  // so original encoding and formatting are preserved. `bom` is kept only for compatibility:
  // tracked files always keep their original BOM state regardless of this flag.
  const legacyIn = { ...DEFAULT_CONFIG.legacyChecks, ...(base && base.legacyChecks), ...(override && override.legacyChecks) };
  const legacyChecks = {
    clangFormat: legacyIn.clangFormat === true,
    cpplint: legacyIn.cpplint === true,
    bom: legacyIn.bom === true,
  };
  return {
    enabled: merged.enabled !== false,
    mode: merged.mode === 'full' ? 'full' : 'incremental',
    lineEnding: ['lf', 'crlf'].includes(merged.lineEnding) ? merged.lineEnding : 'preserve',
    checks,
    legacyChecks,
  };
}

/**
 * Read the global template, overlay the project config field by field, and return the
 * normalized configuration. Missing or corrupt files fall back to defaults and never throw.
 * @param {string} filePath Path of the edited file.
 * @param {string} [globalPath] Global template path (default `~/.claude/cpp-style-template.json`).
 * @returns {{enabled:boolean, mode:string, lineEnding:string, checks:object, legacyChecks:object}}
 * @example
 * loadConfig('/proj/src/a.cc').checks.cpplint // true
 */
function loadConfig(filePath, globalPath = userTemplatePath()) {
  const global = readJsonSafe(globalPath) || {};
  const projectPath = filePath ? findProjectConfig(filePath) : null;
  const project = (projectPath && readJsonSafe(projectPath)) || {};
  return normalize(global, project);
}

module.exports = { loadConfig, ensureUserTemplate, userTemplatePath, DEFAULT_CONFIG };
