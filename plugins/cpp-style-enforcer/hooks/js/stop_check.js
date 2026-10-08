'use strict';

const fs = require('fs');
const path = require('path');

const { readStdinJson } = require('./lib/stdin');
const { diag } = require('./lib/protocol');
const { shouldHandle } = require('./lib/target');
const { consumePendingPaths, recordPendingPaths } = require('./lib/pending_edits');
const { loadConfig } = require('./lib/config');
const { repoRoot, isNew } = require('./lib/git');
const { formatChangedFiles } = require('./lib/report');
const { ensureClangFormatConfig } = require('./lib/ensure_clang_format_config');
const { ensureProjectConfig } = require('./lib/ensure_project_config');
const { applyClangFormat } = require('./steps/clang_format');
const { applyBom } = require('./steps/bom');
const { applyCopyright } = require('./steps/copyright');
const { runCpplint, formatViolations } = require('./steps/cpplint');
const { resolveLineEnding, applyLineEndings, isVisualStudioSource } = require('./lib/line_endings');

/** 低于 hooks.json 的 60s 超时，留出输出与退出余量；超出的文件放回待处理队列。 */
const STOP_DEADLINE_MS = 45000;

function step(name, fn) {
  try {
    return fn();
  } catch (error) {
    diag(`step ${name} 异常跳过: ${error && error.message ? error.message : error}`);
    return undefined;
  }
}

function finish(payload = {}) {
  if (Object.keys(payload).length > 0) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function displayPath(filePath, root) {
  return root ? path.relative(root, filePath) : filePath;
}

/**
 * 仅为 cpplint 选择根目录，避免无 Git 项目的 header guard 包含机器绝对路径。
 * @param {string} filePath
 * @param {string|null} root Git 根
 * @param {string} [cwd] hook 会话目录
 * @returns {string}
 * @example
 * lintRootForFile('/p/src/a.h', null, '/p') // '/p'
 */
function lintRootForFile(filePath, root, cwd) {
  if (root) return root;

  const candidates = [cwd];
  try { candidates.push(process.cwd()); } catch (_) {}
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
      const relative = path.relative(candidate, filePath);
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        return path.resolve(candidate);
      }
    } catch (_) {}
  }
  return path.dirname(filePath);
}

/**
 * 对单个文件执行 clang-format → BOM → 版权头 → 行尾 → cpplint。
 * @param {string} filePath
 * @param {object} input Stop stdin JSON
 * @returns {{changed:boolean, file:string, violations:Array<object>}|null} enabled=false 返回 null
 */
function processFile(filePath, input) {
  const config = loadConfig(filePath);
  if (config.enabled === false) return null;

  const { mode, checks, legacyChecks, copyrightInfo } = config;
  const root = step('repoRoot', () => repoRoot(filePath)) || null;
  const fileIsNew = step('isNew', () => isNew(filePath, root));
  const isNewFile = fileIsNew !== false;
  // mode=full 或新文件 → checks（全套）；老文件 incremental → legacyChecks
  const effectiveChecks = (mode === 'full' || isNewFile) ? checks : legacyChecks;
  const hasChecks = Object.values(effectiveChecks).some(Boolean);
  // 在格式化/版权头可能产生新换行之前固定目标；VS 工程不跟随被误改的 LF。
  const eol = resolveLineEnding(filePath, fs.readFileSync(filePath), config, root);
  const file = displayPath(filePath, root);
  const violations = [];

  if (effectiveChecks.clangFormat && (mode === 'full' || isNewFile)) {
    step('ensure_clang_format_config', () => ensureClangFormatConfig(root));
  }
  if (hasChecks) step('ensure_project_config', () => ensureProjectConfig(root));

  let changed = false;
  if (effectiveChecks.clangFormat) {
    changed = step('clang_format', () => applyClangFormat(filePath, { isNew: isNewFile, root })) === true || changed;
  }
  // 已跟踪文件保持原始编码；BOM 规范化只用于没有历史编码契约的新文件。
  if (isNewFile && effectiveChecks.bom) {
    changed = step('bom', () => applyBom(filePath)) === true || changed;
  }
  if (effectiveChecks.copyright && copyrightInfo && copyrightInfo.company) {
    changed = step('copyright', () => applyCopyright(filePath, copyrightInfo, root)) === true || changed;
  }
  // 基础行尾修复独立于新老文件风格开关和 clang-format 安装状态，不修改 Git index。
  try {
    changed = applyLineEndings(filePath, eol) || changed;
  } catch (error) {
    violations.push({ file, line: 0, category: 'runtime/line_endings',
      message: `行尾修复未完成：${error.message || error}` });
  }

  if (effectiveChecks.cpplint) {
    const lintRoot = lintRootForFile(filePath, root, input.cwd);
    const suppressCopyright = !(copyrightInfo && copyrightInfo.company) || checks.copyright === false;
    const found = step('cpplint', () => runCpplint(filePath, {
      root: lintRoot, suppressCopyright, preserveIncludeOrder: isVisualStudioSource(filePath, root),
    })) || [];
    for (const violation of found) violations.push({ ...violation, file });
  }
  return { changed, file, violations };
}

/**
 * Stop / SubagentStop：统一规范化本代理本轮编辑过的 C++ 文件，有改写或违规时 block 一次。
 * stop_hook_active=true（上次 block 后的续跑）只用 systemMessage 告知用户，避免循环。
 * @returns {Promise<void>}
 * @example
 * // stdin: {"session_id":"s","hook_event_name":"Stop","stop_hook_active":false}
 * // → {"decision":"block","reason":"C++ Style 已在本轮编辑结束后统一规范化 ..."}
 */
async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return finish();

  const filePaths = consumePendingPaths(input)
    .filter(shouldHandle)
    .filter((filePath) => {
      try { return fs.statSync(filePath).isFile(); } catch (_) { return false; }
    });
  if (filePaths.length === 0) return finish();

  const deadline = Date.now() + STOP_DEADLINE_MS;
  const changedFiles = [];
  const allViolations = [];
  const deferred = [];
  for (const filePath of filePaths) {
    if (Date.now() >= deadline) {
      deferred.push(filePath);
      continue;
    }
    const result = processFile(filePath, input);
    if (!result) continue;
    if (result.changed) changedFiles.push(result.file);
    allViolations.push(...result.violations);
  }
  if (deferred.length > 0) {
    // 放回队列由下一次 Stop 处理；放回失败也要明确报告未检查，不能静默丢弃。
    const requeued = recordPendingPaths(input, deferred);
    for (const filePath of deferred) {
      allViolations.push({ file: filePath, line: 0, category: 'runtime/timeout',
        message: requeued ? '本轮收尾耗时超限，未检查，已排入下次结束时处理'
          : '本轮收尾耗时超限，未检查，且无法排入下次处理' });
    }
  }

  if (changedFiles.length === 0 && allViolations.length === 0) return finish();

  const reasons = [];
  if (changedFiles.length > 0) {
    reasons.push(`C++ Style 已在本轮编辑结束后统一规范化 ${changedFiles.length} 个文件（再次编辑前先重新读取）：\n` +
      formatChangedFiles(changedFiles));
  }
  if (allViolations.length > 0) reasons.push(formatViolations(allViolations));
  reasons.push('请检查最终 diff，修复剩余违规，并重新运行相关构建/测试；格式化可能改变 include 顺序或宏展开位置，不要跳过闭环检查。Visual Studio 源工程保持 CRLF，其他工程遵循 lineEnding 配置；缺少末尾换行应补同种换行，不要统一改成 LF。');
  const reason = reasons.join('\n\n');

  if (input.stop_hook_active) return finish({ systemMessage: reason });
  return finish({ decision: 'block', reason });
}

main().catch((error) => {
  try { diag(`stop_check 顶层异常: ${error && error.message ? error.message : error}`); } catch (_) {}
  finish({ systemMessage: 'C++ Style 收尾检查异常，本轮编辑的 C++ 文件未完成规范化，请手动检查或提交前确认。' });
});
