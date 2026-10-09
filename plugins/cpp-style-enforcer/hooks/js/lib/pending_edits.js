'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reduce a session/agent id to a safe directory name, avoiding path traversal and over-long names.
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 * @example
 * safePart('../x', 'session') // '.._x'
 */
function safePart(value, fallback) {
  const text = String(value || fallback).replace(/[^A-Za-z0-9._-]/g, '_');
  return text.slice(0, 120) || fallback;
}

/**
 * Directory of pending C++ edit records: <data dir>/pending-edits/<session_id>/<agent_id|main>.
 *
 * Bucketed by agent_id: a subagent's edits are finished by its own SubagentStop and the main agent's
 * by Stop, so neither steals the other's. The data dir prefers CLAUDE_PLUGIN_DATA; for manual installs
 * it falls back to the system temp dir, never the plugin root, and never silently skips recording.
 * @param {object} input hook stdin JSON
 * @returns {string}
 * @example
 * pendingDir({ session_id: 's1' }) // '<data>/pending-edits/s1/main'
 */
function pendingDir(input) {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA
    || path.join(os.tmpdir(), 'cpp-style-enforcer');
  return path.join(
    path.resolve(dataDir),
    'pending-edits',
    safePart(input && input.session_id, 'session'),
    safePart(input && input.agent_id, 'main'),
  );
}

/**
 * Record the C++ files touched by this edit; one JSON file per tool call, written to a temp file and renamed,
 * so parallel PostToolUse hooks never overwrite each other. Returns false on failure without affecting the edit.
 * @param {object} input hook stdin JSON
 * @param {string[]} filePaths
 * @returns {boolean}
 * @example
 * recordPendingPaths({ session_id: 's1', tool_use_id: 't1' }, ['/p/a.cpp']) // true
 */
function recordPendingPaths(input, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return false;
  const dir = pendingDir(input);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const id = safePart(input && input.tool_use_id, `${process.pid}-${Date.now()}-${Math.random()}`);
    const target = path.join(dir, `${id}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(filePaths.map((filePath) => path.resolve(filePath))), 'utf8');
    fs.renameSync(temp, target);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Take and delete every pending path in the current bucket (deduplicated). Returns [] when the directory is missing.
 * @param {object} input Stop / SubagentStop stdin JSON
 * @returns {string[]}
 * @example
 * consumePendingPaths({ session_id: 's1' }) // ['/p/a.cpp']
 */
function consumePendingPaths(input) {
  const dir = pendingDir(input);
  const paths = new Set();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const values = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          if (typeof value === 'string' && value) paths.add(path.resolve(value));
        }
      } catch (_) {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    return [];
  }
  return [...paths];
}

module.exports = { recordPendingPaths, consumePendingPaths, pendingDir };
