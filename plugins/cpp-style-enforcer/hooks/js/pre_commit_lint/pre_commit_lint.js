#!/usr/bin/env node
/**
 * ABOUTME: PreToolUse 钩子 - git commit 前强制 cpplint 检查。
 * ABOUTME: 拦截 git commit 命令，对暂存区中本项目 C++ 文件运行 cpplint，
 * ABOUTME: 第三方目录豁免，违规时阻止提交。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdinJson, output, log, commandExists, isWindows, getCppStyleMode, isNewFileSince, CPP_EXTENSIONS, EXCLUDED_DIRS } = require('../lib/utils');

// 插件内 cpplint.py（用 __dirname 相对定位，跨平台）
const BUNDLED_CPPLINT = path.join(__dirname, '..', 'cpplint', 'cpplint.py');

const CPPLINT_FILTERS = [
  '-build/include_order',
  '-build/header_guard',
].join(',');

let cpplintCmd = null;

function resolveCpplint() {
  if (cpplintCmd) return cpplintCmd;

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

  if (commandExists('cpplint')) {
    cpplintCmd = ['cpplint'];
    return cpplintCmd;
  }

  return null;
}

function isGitCommitCommand(command) {
  if (!command || typeof command !== 'string') return false;
  return /\bgit\s+commit\b/.test(command);
}

function isCppFile(filePath) {
  return CPP_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isExcludedPath(filePath) {
  const parts = filePath.split(/[/\\]/);
  return parts.some(p => EXCLUDED_DIRS.has(p.toLowerCase()));
}

function getStagedCppFiles(cwd) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split('\n')
    .map(f => f.trim())
    .filter(f => f && isCppFile(f) && !isExcludedPath(f));
}

function runCpplintOnFiles(files, cwd, extraFilter) {
  const cmd = resolveCpplint();
  if (!cmd) return { hasErrors: false, output: '', notInstalled: true };

  const filterStr = extraFilter ? CPPLINT_FILTERS + ',' + extraFilter : CPPLINT_FILTERS;
  const bomFiles = [];
  try {
    for (const f of files) {
      const fullPath = path.resolve(cwd, f);
      try {
        if (!fs.existsSync(fullPath)) continue;
        const raw = fs.readFileSync(fullPath);
        if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
          fs.writeFileSync(fullPath, raw.slice(3));
          bomFiles.push(fullPath);
        }
      } catch (e) {
        // 单文件剥离失败 -> 跳过, 继续后续文件
      }
    }

    const fullPaths = files.map(f => path.resolve(cwd, f));
    const lintArgs = [
      ...cmd.slice(1),
      '--filter=' + filterStr,
      '--counting=detailed',
      '--quiet',
      ...fullPaths,
    ];

    let result;
    try {
      result = spawnSync(cmd[0], lintArgs, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
      });
    } finally {
      for (const fullPath of bomFiles) {
        try {
          const data = fs.readFileSync(fullPath);
          const alreadyHasBom =
            data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF;
          if (!alreadyHasBom) {
            fs.writeFileSync(fullPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), data]));
          }
        } catch (e) {
          // 单文件恢复失败 -> 继续下一个
        }
      }
    }

    const stderr = (result.stderr || '').trim();
    return {
      hasErrors: result.status !== 0 && stderr.length > 0,
      output: stderr,
      notInstalled: false,
    };
  } catch (e) {
    return { hasErrors: false, output: String(e), notInstalled: false };
  }
}

function parseErrors(lintOutput) {
  const lines = lintOutput.split('\n');
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
  } catch {
    process.exit(0);
    return;
  }

  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';
  const cwd = hookInput.cwd || process.cwd();

  if (!isGitCommitCommand(command)) {
    process.exit(0);
    return;
  }

  // 决定检查范围:
  //   - full 模式: 检查全部暂存的 C++ 文件
  //   - incremental 模式: 仅检查"基线 commit 之后新增"的文件
  //   - null / checks.cpplint=false: 跳过
  const { mode, baseline, root, checks, copyrightInfo } = getCppStyleMode(cwd);
  if ((mode !== 'full' && mode !== 'incremental') || !checks.cpplint) {
    process.exit(0);
    return;
  }

  let stagedFiles = getStagedCppFiles(cwd);
  if (mode === 'incremental') {
    const repoRoot = root || cwd;
    stagedFiles = stagedFiles.filter(f =>
      isNewFileSince(path.resolve(repoRoot, f), baseline, repoRoot)
    );
  }
  if (stagedFiles.length === 0) {
    process.exit(0);
    return;
  }

  // 屏蔽 legal/copyright 的两种情况: copyright 关闭, 或 company 为空(实际不写头).
  const company = copyrightInfo && typeof copyrightInfo.company === 'string'
    ? copyrightInfo.company.trim() : '';
  const suppressCopyright = !checks.copyright || !company;
  const extraFilter = suppressCopyright ? '-legal/copyright' : null;
  const { hasErrors, output: lintOutput, notInstalled } = runCpplintOnFiles(stagedFiles, cwd, extraFilter);

  if (notInstalled) {
    log('[pre_commit_lint] cpplint 未找到，跳过检查');
    process.exit(0);
    return;
  }

  if (!hasErrors) {
    process.exit(0);
    return;
  }

  const errors = parseErrors(lintOutput);
  if (errors.length === 0) {
    process.exit(0);
    return;
  }

  const MAX_ERRORS_SHOWN = 10;
  const shownErrors = errors.slice(0, MAX_ERRORS_SHOWN);
  const hiddenCount = errors.length - shownErrors.length;

  const errorList = shownErrors
    .map(e => `  ${e.message} [${e.category}]`)
    .join('\n');

  const truncationNote = hiddenCount > 0
    ? `\n  ... 还有 ${hiddenCount} 个违规未显示`
    : '';

  const reason = [
    `[BLOCKED] git commit 被阻止：暂存区 C++ 文件存在 ${errors.length} 个 cpplint 违规：`,
    errorList,
    truncationNote,
    '',
    '必须修复所有违规后才能提交。第三方目录已自动豁免。',
  ].join('\n');

  output({
    decision: 'block',
    reason,
  });

  process.exit(2);
}

module.exports = main;

if (require.main === module) {
  main();
}
