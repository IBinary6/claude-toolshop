#!/usr/bin/env node
/**
 * ABOUTME: PostToolUse 钩子 - C++ Google Style 规范检查。
 * ABOUTME: 编辑 C++ 文件后自动运行 cpplint，违规时强制 Claude 修复。
 * ABOUTME: 内嵌 cpplint.py（同目录），无需系统安装。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdinJson, isWindows, commandExists, CPP_EXTENSIONS, EXCLUDED_DIRS, extractPathFromCommand, resolveFilePath } = require('../lib/utils');

// 内嵌的 cpplint.py 路径（与本脚本同目录，用 __dirname 跨平台定位）
const BUNDLED_CPPLINT = path.join(__dirname, 'cpplint.py');

// cpplint 可执行路径缓存
let cpplintCmd = null;

// cpplint 过滤规则
const CPPLINT_FILTERS = [
  '-build/include_order',    // include 顺序由 clang-format 管理
  '-whitespace/indent_namespace',  // namespace 缩进由 clang-format 管理，避免与 formatter 冲突
  '-whitespace/comments',    // 注释格式由 clang-format 管理，BOM 可能导致误报
].join(',');

/**
 * 构造本次运行的 filter 串。
 * 当上游 (post_edit_pipeline) 设置 CPP_STYLE_NO_COPYRIGHT=1 时,
 * 说明 copyright 步骤被关闭或版权信息缺失(company 为空), 此时屏蔽
 * legal/copyright 规则, 否则会因"缺版权头"误拦截。
 */
function buildFilters() {
  if (process.env.CPP_STYLE_NO_COPYRIGHT === '1') {
    return CPPLINT_FILTERS + ',-legal/copyright';
  }
  return CPPLINT_FILTERS;
}

// 风格类违规：检测到时询问用户，而非强制拦截
const SOFT_CATEGORIES = new Set(['build/include_subdir']);

/**
 * 解析 cpplint 可执行路径：内嵌优先 → 系统 cpplint → python -m cpplint
 * @returns {string[]|null} [cmd, ...args] 或 null
 */
function resolveCpplint() {
  if (cpplintCmd) return cpplintCmd;

  // 1. 内嵌 cpplint.py
  if (fs.existsSync(BUNDLED_CPPLINT)) {
    const pythonCmd = isWindows ? 'python' : 'python3';
    if (commandExists(pythonCmd)) {
      cpplintCmd = [pythonCmd, BUNDLED_CPPLINT];
      return cpplintCmd;
    }
    if (isWindows && commandExists('python3')) {
      cpplintCmd = ['python3', BUNDLED_CPPLINT];
      return cpplintCmd;
    }
  }

  // 2. 系统 cpplint
  if (commandExists('cpplint')) {
    cpplintCmd = ['cpplint'];
    return cpplintCmd;
  }

  return null;
}

/**
 * 判断文件是否需要 cpplint 检查
 */
function shouldLint(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CPP_EXTENSIONS.has(ext)) return false;

  const parts = filePath.split(/[/\\]/);
  for (const part of parts) {
    if (EXCLUDED_DIRS.has(part.toLowerCase())) return false;
  }
  return true;
}

/**
 * 运行 cpplint 并返回结果
 * 自动处理 UTF-8 BOM：lint 前剥离，lint 后恢复，避免误报
 */
function runCpplint(filePath) {
  const cmd = resolveCpplint();
  if (!cmd) return { hasErrors: false, output: '', notInstalled: true };

  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const raw = fs.readFileSync(filePath);
  let bomOffset = 0;
  while (
    bomOffset + 3 <= raw.length &&
    raw[bomOffset] === 0xEF && raw[bomOffset + 1] === 0xBB && raw[bomOffset + 2] === 0xBF
  ) {
    bomOffset += 3;
  }
  const hadBom = bomOffset > 0;
  if (hadBom) {
    fs.writeFileSync(filePath, raw.slice(bomOffset));
  }

  const lintArgs = [
    ...cmd.slice(1),
    '--filter=' + buildFilters(),
    '--counting=detailed',
    '--quiet',
    filePath,
  ];

  let result;
  try {
    result = spawnSync(cmd[0], lintArgs, {
      stdio: 'pipe',
      timeout: 12000,
      windowsHide: isWindows,
    });
  } finally {
    if (hadBom) {
      const current = fs.readFileSync(filePath);
      let stripped = 0;
      while (
        stripped + 3 <= current.length &&
        current[stripped] === 0xEF && current[stripped + 1] === 0xBB && current[stripped + 2] === 0xBF
      ) {
        stripped += 3;
      }
      fs.writeFileSync(filePath, Buffer.concat([BOM, current.slice(stripped)]));
    }
  }

  const output = (result.stderr || Buffer.alloc(0)).toString('utf-8').trim();

  return {
    hasErrors: result.status !== 0,
    output,
  };
}

/**
 * 解析 cpplint 输出，提取关键违规信息
 */
function parseErrors(output) {
  const lines = output.split('\n');
  const errors = [];

  for (const line of lines) {
    const match = line.match(/^.+?:(\d+):\s*(.+?)\s*\[(.+?)\]\s*\[(\d+)\]/);
    if (match) {
      errors.push({
        line: parseInt(match[1], 10),
        message: match[2].trim(),
        category: match[3],
        confidence: parseInt(match[4], 10),
      });
    }
  }

  return errors;
}

async function main() {
  let hookInput;
  try {
    hookInput = await readStdinJson();
  } catch (e) {
    process.exit(0);
    return;
  }

  const filePath = resolveFilePath(hookInput);
  if (!filePath) {
    process.exit(0);
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    process.exit(0);
    return;
  }

  if (!shouldLint(filePath)) {
    process.exit(0);
    return;
  }

  const basename = path.basename(filePath);
  const { hasErrors, output, notInstalled } = runCpplint(filePath);

  // 复跑提示: 用本脚本自身作为手动复跑入口, 避免现场拼 Python BOM 脚本浪费 token.
  const cwd = (hookInput && hookInput.cwd) || process.cwd();
  const relFile = path.relative(cwd, filePath).split(path.sep).join('/');
  const rerunHint = `重跑校验: node "${__filename}" ${relFile}`;

  if (notInstalled) {
    console.error('\n  ⚠ [cpplint] 未找到可用的 cpplint（需 Python 或系统 cpplint），跳过规范检查');
    process.exit(0);
    return;
  }

  if (!hasErrors) {
    // 通过时静默, 避免每次编辑都向主上下文回灌一行"✓ 通过"信息.
    process.exit(0);
    return;
  }

  const errors = parseErrors(output);
  if (errors.length === 0) {
    process.exit(0);
    return;
  }

  const hardErrors = errors.filter(e => !SOFT_CATEGORIES.has(e.category));
  const softErrors = errors.filter(e => SOFT_CATEGORIES.has(e.category));

  const MAX_ERRORS_SHOWN = 5;

  // ── 硬性违规：强制修复 ──
  if (hardErrors.length > 0) {
    const shown = hardErrors.slice(0, MAX_ERRORS_SHOWN);
    const hidden = hardErrors.length - shown.length;
    const errorList = shown.map(e => `  ${basename}:${e.line}: ${e.message} [${e.category}]`).join('\n');
    const truncNote = hidden > 0 ? `\n  ... 还有 ${hidden} 个违规未显示，修复以上问题后重新检查。` : '';

    console.error(`\n  🚫 [cpplint] ${basename}: 发现 ${hardErrors.length} 个 Google Style 违规`);
    console.error(errorList + truncNote);
    console.error(`  ⛔ 操作已拦截，必须修复后重新编辑该文件。`);
    console.error(`  💡 ${rerunHint}`);

    console.log(JSON.stringify({
      decision: 'block',
      reason: [
        `[BLOCKED] cpplint 检测到 ${basename} 存在 ${hardErrors.length} 个 Google C++ Style 违规（显示前 ${shown.length} 条）:`,
        errorList,
        truncNote,
        '',
        '你必须立即修复以上所有违规，然后重新编辑该文件。',
        '这是强制性要求，不可跳过，不可忽略。修复完成前不要进行其他操作。',
        '',
        `修完后用 \`${rerunHint}\` 复跑校验, 不要现场拼 Python BOM 脚本.`,
      ].join('\n'),
    }));
    process.exit(2);
    return;
  }

  // ── 风格类违规（build/include_subdir）：询问用户 ──
  if (softErrors.length > 0) {
    const shown = softErrors.slice(0, MAX_ERRORS_SHOWN);
    const hidden = softErrors.length - shown.length;
    const errorList = shown.map(e => `  ${basename}:${e.line}: ${e.message} [${e.category}]`).join('\n');
    const truncNote = hidden > 0 ? `\n  ... 还有 ${hidden} 个未显示。` : '';

    console.error(`\n  ⚠ [cpplint] ${basename}: 发现 ${softErrors.length} 个 include 路径风格违规`);
    console.error(errorList + truncNote);
    console.error(`  💡 ${rerunHint}`);

    console.log(JSON.stringify({
      decision: 'block',
      reason: [
        `[ASK_USER] cpplint 检测到 ${basename} 存在 ${softErrors.length} 个 build/include_subdir 风格违规（头文件应使用完整目录路径）:`,
        errorList,
        truncNote,
        '',
        '请使用 AskUserQuestion 工具询问用户：',
        '  问题："cpplint 发现 include 路径未使用完整目录前缀（build/include_subdir）。如何处理？"',
        '  选项 1："修复后再继续" — 将 #include "file.h" 改为 #include "dir/to/file.h"',
        '  选项 2："忽略，直接继续" — 保留现有相对路径，跳过此次修复',
        '根据用户选择决定是否修复，不可自行决定。',
        '',
        `复跑校验: \`${rerunHint}\``,
      ].join('\n'),
    }));
    process.exit(2);
  }
}

// CLI 直接调用支持: node cpplint_check.js <file>
// 把 argv 文件参数包成 hook input 形式, 复用 main() 流程.
function buildInputFromArgv() {
  const fileArg = process.argv.slice(2).find(a => {
    const ext = path.extname(a).toLowerCase();
    return CPP_EXTENSIONS.has(ext);
  });
  if (!fileArg) return null;
  return { tool_input: { file_path: path.resolve(process.cwd(), fileArg) }, cwd: process.cwd() };
}

const argvInput = buildInputFromArgv();
if (argvInput) {
  // CLI 模式: 不读 stdin, 直接用 argv 文件跑
  (async () => {
    const filePath = argvInput.tool_input.file_path;
    if (!fs.existsSync(filePath) || !shouldLint(filePath)) {
      process.exit(0);
      return;
    }
    const basename = path.basename(filePath);
    const { hasErrors, output, notInstalled } = runCpplint(filePath);
    if (notInstalled || !hasErrors) {
      if (!notInstalled) console.error(`  ✓ [cpplint] ${basename}: 通过`);
      process.exit(0);
      return;
    }
    const errors = parseErrors(output);
    const list = errors.slice(0, 20).map(e => `  ${basename}:${e.line}: ${e.message} [${e.category}]`).join('\n');
    console.error(`  🚫 [cpplint] ${basename}: ${errors.length} 个违规`);
    console.error(list);
    process.exit(errors.length > 0 ? 1 : 0);
  })();
} else {
  main();
}
