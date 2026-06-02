'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 读取插件内置默认规则
 */
function loadDefaults() {
  const defaultsPath = path.resolve(__dirname, '..', '..', '..', 'defaults', 'dispatch-rules.json');
  return JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
}

/**
 * 读取全局配置（固定路径，跨盘安全）
 * 位置：~/.agent-dispatch/config.json
 * 不存在 / 空 / 非法 JSON → 返回 null → 跳过全局层
 */
function loadGlobalConfig() {
  const globalPath = path.join(os.homedir(), '.agent-dispatch', 'config.json');
  if (!fs.existsSync(globalPath)) return null;
  try {
    const content = fs.readFileSync(globalPath, 'utf8').trim();
    if (!content) return null;
    return JSON.parse(content);
  } catch (e) {
    process.stderr.write(`[agent-dispatch] WARN: invalid global config: ${e.message}\n`);
    return null;
  }
}

/**
 * 查找项目级配置文件（向上遍历，最多 10 层）
 * 优先查找新路径 .agent-dispatch/config.json，回退查找旧路径 .agent-dispatch.json
 * 排除全局配置路径（避免与 loadGlobalConfig 重复合并）
 * @param {string} [startDir] 起始目录，默认 process.cwd()
 * @returns {string|null} 配置文件绝对路径，或 null
 */
function findProjectConfig(startDir) {
  const globalConfigPath = path.join(os.homedir(), '.agent-dispatch', 'config.json');
  let dir = startDir || process.cwd();
  for (let i = 0; i < 10; i++) {
    // 新路径优先（排除全局路径）
    const newPath = path.join(dir, '.agent-dispatch', 'config.json');
    if (fs.existsSync(newPath) && path.resolve(newPath) !== path.resolve(globalConfigPath)) {
      return newPath;
    }
    // 旧路径兼容
    const oldPath = path.join(dir, '.agent-dispatch.json');
    if (fs.existsSync(oldPath)) return oldPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 合并配置层：将 overrides 应用到 defaults 上
 * 合并语义：add 追加，remove 移除，modules Object.assign
 */
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
  if (!result.whitelist.mcp_block_exact) {
    result.whitelist.mcp_block_exact = [];
  }
  if (ov.mcp_block_exact_add && ov.mcp_block_exact_add.length) {
    result.whitelist.mcp_block_exact.push(...ov.mcp_block_exact_add);
  }
  if (ov.mcp_block_exact_remove && ov.mcp_block_exact_remove.length) {
    const rm = new Set(ov.mcp_block_exact_remove);
    result.whitelist.mcp_block_exact = result.whitelist.mcp_block_exact.filter((t) => !rm.has(t));
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

/**
 * 加载最终有效配置（三层合并）
 * 解析顺序：plugin defaults → global config → project config
 * @param {string} [cwd] 用于查找项目配置的起始目录，默认 process.cwd()
 */
function loadConfig(cwd) {
  const defaults = loadDefaults();

  // 第2层：全局配置
  const globalCfg = loadGlobalConfig();
  let result = defaults;
  if (globalCfg) {
    result = mergeConfig(result, globalCfg);
  }

  // 第3层：项目配置
  const projectPath = findProjectConfig(cwd || process.cwd());
  if (projectPath) {
    try {
      const content = fs.readFileSync(projectPath, 'utf8').trim();
      if (content) {
        const projectCfg = JSON.parse(content);
        result = mergeConfig(result, projectCfg);
      }
    } catch (e) {
      process.stderr.write(`[agent-dispatch] WARN: invalid project config: ${e.message}\n`);
    }
  }

  return result;
}

module.exports = { loadConfig, loadDefaults, loadGlobalConfig, mergeConfig, findProjectConfig };
