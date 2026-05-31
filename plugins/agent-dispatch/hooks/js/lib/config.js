'use strict';
const fs = require('fs');
const path = require('path');

function loadDefaults() {
  const defaultsPath = path.resolve(__dirname, '..', '..', '..', 'defaults', 'dispatch-rules.json');
  return JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
}

function findProjectConfig() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.agent-dispatch.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function mergeConfig(defaults, overrides) {
  const result = JSON.parse(JSON.stringify(defaults));

  if (overrides.modules) {
    Object.assign(result.modules, overrides.modules);
  }

  const ov = overrides.overrides || {};
  if (ov.tools_add && ov.tools_add.length) {
    result.whitelist.tools.push(...ov.tools_add);
  }
  if (ov.tools_remove && ov.tools_remove.length) {
    const rm = new Set(ov.tools_remove);
    result.whitelist.tools = result.whitelist.tools.filter((t) => !rm.has(t));
  }
  if (ov.mcp_prefixes_add && ov.mcp_prefixes_add.length) {
    result.whitelist.mcp_prefixes.push(...ov.mcp_prefixes_add);
  }
  if (ov.bash_heads_add && ov.bash_heads_add.length) {
    result.whitelist.bash_safe_heads.push(...ov.bash_heads_add);
  }
  if (ov.bash_heads_remove && ov.bash_heads_remove.length) {
    const rm = new Set(ov.bash_heads_remove);
    result.whitelist.bash_safe_heads = result.whitelist.bash_safe_heads.filter((h) => !rm.has(h));
  }

  return result;
}

function loadConfig() {
  const defaults = loadDefaults();
  const projectPath = findProjectConfig();
  if (!projectPath) return defaults;
  try {
    const projectOverrides = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    return mergeConfig(defaults, projectOverrides);
  } catch {
    return defaults;
  }
}

module.exports = { loadConfig, loadDefaults, mergeConfig, findProjectConfig };
