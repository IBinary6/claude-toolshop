#!/usr/bin/env node
'use strict';

/**
 * SessionStart Hook — 会话初始化时自动引导配置目录结构
 *
 * 职责：
 * 1. 确保全局配置目录 ~/.agent-dispatch/ + skeleton config.json
 * 2. 确保项目配置目录 <git_root>/.agent-dispatch/ + skeleton config.json
 * 3. 确保 .agent-dispatch/ 在项目 .gitignore 中
 * 4. 旧配置 .agent-dispatch.json 自动迁移到新位置
 * 5. Schema 版本检查 + 原地升级
 *
 * 契约：纯 side-effect，exit 0，无 stdout 输出
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { readStdinJson, log } = require('./lib/utils');

// ─── 常量 ───
const CURRENT_SCHEMA_VERSION = 2;
const GLOBAL_DIR = path.join(os.homedir(), '.agent-dispatch');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_DIR, 'config.json');
const DEFAULT_OVERRIDES = {
  tools_add: [],
  tools_remove: [],
  mcp_prefixes_add: [],
  mcp_prefixes_remove: [],
  mcp_block_exact_add: [],
  mcp_block_exact_remove: [],
  bash_heads_add: [],
  bash_heads_remove: []
};

const GLOBAL_SKELETON = {
  schema_version: CURRENT_SCHEMA_VERSION,
  _doc: '全局 agent-dispatch 配置 — 对所有项目生效的默认覆盖',
  modules: {},
  overrides: DEFAULT_OVERRIDES
};

const PROJECT_SKELETON = {
  schema_version: CURRENT_SCHEMA_VERSION,
  _doc: '项目级配置。修改此文件覆盖全局设置，空 overrides = 继承全局。',
  modules: {},
  overrides: DEFAULT_OVERRIDES
};

// ─── 辅助函数 ───

/**
 * 解析 git 仓库根目录
 * @returns {string|null} 绝对路径或 null（非 git 仓库）
 */
function resolveGitRoot(cwd) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 确保目录存在（递归创建）
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log(`[agent-dispatch] created dir: ${dirPath}`);
  }
}

/**
 * 安全读取 JSON 文件
 * @returns {object|null} 解析后的对象，或 null（文件不存在/空/非法）
 */
function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 确保全局配置目录和 skeleton config.json 存在
 */
function ensureGlobalConfig() {
  ensureDir(GLOBAL_DIR);
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(GLOBAL_SKELETON, null, 2), 'utf8');
    log(`[agent-dispatch] bootstrapped global config: ${GLOBAL_CONFIG_PATH}`);
  }
}

/**
 * 确保项目 .agent-dispatch/ 目录存在
 */
function ensureProjectDir(gitRoot) {
  if (!gitRoot) return;
  const projectDir = path.join(gitRoot, '.agent-dispatch');
  ensureDir(projectDir);
}

/**
 * 确保项目 .agent-dispatch/config.json 存在
 * 文件一旦存在就不覆盖（尊重用户修改）
 */
function ensureProjectConfig(gitRoot) {
  if (!gitRoot) return;
  const configPath = path.join(gitRoot, '.agent-dispatch', 'config.json');
  if (fs.existsSync(configPath)) return;

  fs.writeFileSync(configPath, JSON.stringify(PROJECT_SKELETON, null, 2), 'utf8');
  log(`[agent-dispatch] bootstrapped project config: ${configPath}`);
}

/**
 * 确保 .agent-dispatch/ 在项目 .gitignore 中
 * - 已存在：逐行精确匹配，不重复追加
 * - 不存在：创建文件并写入条目
 */
function ensureGitignore(gitRoot) {
  if (!gitRoot) return;
  const gitignorePath = path.join(gitRoot, '.gitignore');
  const entry = '.agent-dispatch/';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split(/\r?\n/);
    if (lines.some(line => line.trim() === entry)) return;
    // 追加：确保前面有换行
    const separator = content.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(gitignorePath, `${separator}${entry}\n`, 'utf8');
    log(`[agent-dispatch] appended ${entry} to .gitignore`);
  } else {
    fs.writeFileSync(gitignorePath, `${entry}\n`, 'utf8');
    log(`[agent-dispatch] created .gitignore with ${entry}`);
  }
}

/**
 * 旧配置迁移：.agent-dispatch.json → .agent-dispatch/config.json
 * 仅当旧文件存在 且 新文件不存在 时执行
 */
function migrateLegacyConfig(gitRoot) {
  if (!gitRoot) return;
  const oldPath = path.join(gitRoot, '.agent-dispatch.json');
  const newPath = path.join(gitRoot, '.agent-dispatch', 'config.json');

  if (!fs.existsSync(oldPath)) return;
  if (fs.existsSync(newPath)) return;

  try {
    const content = fs.readFileSync(oldPath, 'utf8');
    ensureDir(path.join(gitRoot, '.agent-dispatch'));
    fs.writeFileSync(newPath, content, 'utf8');
    fs.unlinkSync(oldPath);
    log(`[agent-dispatch] migrated: ${oldPath} → ${newPath}`);
  } catch (e) {
    log(`[agent-dispatch] migration failed: ${e.message}`);
  }
}

function ensureConfigShape(obj) {
  let changed = false;
  if (!obj.modules || typeof obj.modules !== 'object' || Array.isArray(obj.modules)) {
    obj.modules = {};
    changed = true;
  }
  if (!obj.overrides || typeof obj.overrides !== 'object' || Array.isArray(obj.overrides)) {
    obj.overrides = {};
    changed = true;
  }
  for (const key of Object.keys(DEFAULT_OVERRIDES)) {
    if (!Array.isArray(obj.overrides[key])) {
      obj.overrides[key] = [];
      changed = true;
    }
  }
  return changed;
}

/**
 * Schema 版本检查 + 原地升级
 * 如果文件存在且 schema_version 缺失或过旧，添加/更新字段
 */
function upgradeSchemaVersion(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return;
  const obj = safeReadJson(configPath);
  if (!obj) return;

  let changed = ensureConfigShape(obj);
  if (!obj.schema_version || obj.schema_version < CURRENT_SCHEMA_VERSION) {
    obj.schema_version = CURRENT_SCHEMA_VERSION;
    changed = true;
  }
  if (changed) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf8');
      log(`[agent-dispatch] upgraded schema → v${CURRENT_SCHEMA_VERSION}: ${configPath}`);
    } catch (e) {
      log(`[agent-dispatch] schema upgrade failed: ${e.message}`);
    }
  }
}

// ─── 主函数 ───

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    process.exit(0);
    return;
  }

  // 解析 cwd：stdin.cwd → 环境变量 → process.cwd()
  const cwd = (input && typeof input.cwd === 'string' && input.cwd)
    || process.env.CLAUDE_WORKING_DIRECTORY
    || process.cwd();

  const gitRoot = resolveGitRoot(cwd);

  try {
    // 步骤1：全局配置引导
    ensureGlobalConfig();

    // 步骤2：项目目录引导（需 git root）
    ensureProjectDir(gitRoot);

    // 步骤3：旧配置迁移（必须在 ensureProjectConfig 之前，否则迁移条件不满足）
    migrateLegacyConfig(gitRoot);

    // 步骤4：项目配置引导
    ensureProjectConfig(gitRoot);

    // 步骤5：.gitignore 管理
    ensureGitignore(gitRoot);

    // 步骤6：Schema 版本升级
    upgradeSchemaVersion(GLOBAL_CONFIG_PATH);
    if (gitRoot) {
      upgradeSchemaVersion(path.join(gitRoot, '.agent-dispatch', 'config.json'));
    }
  } catch (e) {
    // hook 失败不阻塞会话启动
    log(`[agent-dispatch] session_start error: ${e.message}`);
  }

  process.exit(0);
}

main();
