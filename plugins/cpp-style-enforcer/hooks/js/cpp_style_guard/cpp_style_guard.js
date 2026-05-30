#!/usr/bin/env node
/**
 * ABOUTME: SessionStart 钩子 - C++ 项目风格检查模式检测。
 * ABOUTME: 会话启动时检查项目是否有 .claude-cpp-style 标志文件，
 * ABOUTME: 若为 C++ 项目且无标志文件，提示 Claude 询问用户选择模式；
 * ABOUTME: .claude-cpp-style 内容继承用户级模板 ~/.claude/cpp-style-template.json。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isWindows, ensureUserTemplate, readUserTemplate } = require('../lib/utils');

const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx']);

// 插件出厂默认模板（用 __dirname 定位，跨平台）
const PLUGIN_DEFAULT_TEMPLATE = path.join(
  __dirname, '..', '..', '..', 'templates', 'cpp-style-template.default.json'
);

// 快速扫描的目录（只看常见位置，不递归全盘）
const SCAN_DIRS = ['', 'src', 'include', 'source', 'lib', 'core'];

/**
 * 获取 git 仓库根目录
 */
function getRepoRoot(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    stdio: 'pipe',
    timeout: 3000,
    windowsHide: isWindows,
  });
  if (result.status !== 0) return null;
  return (result.stdout || Buffer.alloc(0)).toString('utf-8').trim() || null;
}

/**
 * 检测 git 仓库中是否有 C/C++ 文件。
 * 优先用 git ls-files 查询（不受目录嵌套层级限制）；
 * git 失败时回退到目录扫描。
 */
function hasCppFiles(repoRoot) {
  // 方式 1: git ls-files（覆盖所有已跟踪 + 未跟踪文件）
  const extGlob = [...CPP_EXTENSIONS].map(e => '*' + e);
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...extGlob], {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 5000,
    windowsHide: isWindows,
  });
  if (result.status === 0) {
    const output = (result.stdout || Buffer.alloc(0)).toString('utf-8').trim();
    if (output.length > 0) return true;
  }

  // 方式 2: 回退目录扫描（git 命令失败时）
  for (const sub of SCAN_DIRS) {
    const dir = sub ? path.join(repoRoot, sub) : repoRoot;
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        if (CPP_EXTENSIONS.has(ext)) return true;
      }
    } catch (_) {}
  }
  // 补充：检查是否有 .vcxproj / CMakeLists.txt 等 C++ 项目标识
  try {
    const entries = fs.readdirSync(repoRoot);
    for (const entry of entries) {
      if (entry === 'CMakeLists.txt' || entry.endsWith('.vcxproj')) return true;
    }
  } catch (_) {}
  return false;
}

/**
 * 读取用户模板的 checks + copyrightInfo 作为 .claude-cpp-style 的内容基底。
 * 用户模板缺失/损坏时回退安全默认值。
 */
function templateBase() {
  const tpl = readUserTemplate() || {};
  const c = (tpl.checks && typeof tpl.checks === 'object') ? tpl.checks : {};
  const checks = {
    clangFormat: c.clangFormat !== false,
    copyright: c.copyright !== false,
    cpplint: c.cpplint !== false,
    bom: c.bom !== false,
  };
  const copyrightInfo = (tpl.copyrightInfo && typeof tpl.copyrightInfo === 'object')
    ? tpl.copyrightInfo
    : { company: '', author: '', dateFormat: 'YYYY/MM/DD HH:mm' };
  return { checks, copyrightInfo };
}

function main() {
  const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

  // 先确保用户级模板存在（不存在则从插件出厂默认复制）
  ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE);

  // 非 git 仓库 → 静默退出
  const repoRoot = getRepoRoot(cwd);
  if (!repoRoot) {
    process.exit(0);
    return;
  }

  // 已有标志文件 → 静默退出
  const flagFile = path.join(repoRoot, '.claude-cpp-style');
  if (fs.existsSync(flagFile)) {
    process.exit(0);
    return;
  }

  // 非 C++ 项目 → 静默退出
  if (!hasCppFiles(repoRoot)) {
    process.exit(0);
    return;
  }

  // C++ 项目但无标志文件 → 提示 Claude 询问用户
  // 取当前 HEAD 作为"老项目"基线（仓库无 commit 时为 null）
  const headProbe = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 3000,
    windowsHide: isWindows,
  });
  const headHash = headProbe.status === 0
    ? (headProbe.stdout || Buffer.alloc(0)).toString('utf-8').trim()
    : null;

  // 内容基底来自用户模板（含公司名等），只覆盖 mode / baseline
  const base = templateBase();
  const fullJson = JSON.stringify({ ...base, mode: 'full' }, null, 2);
  const incrementalJson = JSON.stringify(
    { ...base, mode: 'incremental', baseline: headHash || '' },
    null, 2
  );

  // 预生成两份配置到插件临时目录，Claude 选完直接 cp
  const tmpDir = path.join(__dirname, '..', '..', '..', '.tmp');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
  const fullPath = path.join(tmpDir, 'config-full.json');
  const incrPath = path.join(tmpDir, 'config-incremental.json');
  fs.writeFileSync(fullPath, fullJson, 'utf-8');
  fs.writeFileSync(incrPath, incrementalJson, 'utf-8');

  // stdout 精简指令（约 300 字节）
  console.log([
    `[IMPORTANT] [cpp-style-enforcer] C++ 项目（${repoRoot}）未配置风格检查。`,
    '在回复用户之前，先用 AskUserQuestion 询问：',
    '  问题："检测到 C++ 项目，选择风格检查模式"',
    '  选项 1："新项目 — 全部文件完整检查"',
    '  选项 2："老项目 — 仅新文件完整检查"',
    `选项 1 → Bash: cp "${fullPath.replace(/\\/g,'/')}" "${flagFile.replace(/\\/g,'/')}"`,
    `选项 2 → Bash: cp "${incrPath.replace(/\\/g,'/')}" "${flagFile.replace(/\\/g,'/')}"`,
  ].join('\n'));
  process.exit(0);
}

main();
