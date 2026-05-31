'use strict';

const { readStdinJson } = require('./lib/stdin');
const { passSilent, blockClaude, diag } = require('./lib/protocol');
const { resolveFilePath, shouldHandle } = require('./lib/target');
const { loadConfig } = require('./lib/config');
const { repoRoot, isNew } = require('./lib/git');
const { ensureClangFormatConfig } = require('./lib/ensure_clang_format_config');
const { ensureProjectConfig } = require('./lib/ensure_project_config');
const { isCMakeProject } = require('./lib/project');
const { applyClangFormat } = require('./steps/clang_format');
const { applyBom } = require('./steps/bom');
const { applyCopyright } = require('./steps/copyright');
const { runCpplint, formatViolations } = require('./steps/cpplint');

function step(name, fn) {
  try {
    return fn();
  } catch (e) {
    diag(`step ${name} 异常跳过: ${e && e.message ? e.message : e}`);
    return undefined;
  }
}

async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return passSilent();

  const filePath = resolveFilePath(input);
  if (!filePath || !shouldHandle(filePath)) return passSilent();

  const config = loadConfig(filePath);
  if (config.enabled === false) return passSilent();

  const { mode, checks, copyrightInfo } = config;
  const root = step('repoRoot', () => repoRoot(filePath)) || null;
  const fileIsNew = step('isNew', () => isNew(filePath, root));
  const applyTriple = mode === 'full' || (mode === 'incremental' && fileIsNew !== false);
  const isCMake = step('isCMake', () => isCMakeProject(filePath)) === true;

  // 1. clang-format（对所有 clangFormat 文件都跑，新老用不同模式）
  //    新文件/full → 整文件全格；老文件(incremental && !isNew) → 仅格改动行 + include 不排序
  if (checks.clangFormat) {
    const clangIsNew = applyTriple; // full 或 新文件 → 整文件模式；否则老文件改动行模式
    // 走全套（新文件/full）时，项目根缺 .clang-format 则生成 Google 风格，三方共享同一份配置
    if (applyTriple) {
      step('ensure_clang_format_config', () => ensureClangFormatConfig(root));
      step('ensure_project_config', () => ensureProjectConfig(root));
    }
    step('clang_format', () => applyClangFormat(filePath, { isNew: clangIsNew, root }));
  }

  // 2. BOM（独立于 mode；CMake 项目跳过）
  if (checks.bom && !isCMake) {
    step('bom', () => applyBom(filePath, { isCMake }));
  }

  // 3. copyright（仅全套文件；company 非空才写）
  if (applyTriple && checks.copyright && copyrightInfo && copyrightInfo.company) {
    step('copyright', () => applyCopyright(filePath, copyrightInfo));
  }

  // 4. cpplint（仅全套文件）→ 一律硬违规，有违规即 block
  if (applyTriple && checks.cpplint) {
    const suppressCopyright = !(copyrightInfo && copyrightInfo.company) || checks.copyright === false;
    const violations = step('cpplint', () => runCpplint(filePath, { root, suppressCopyright })) || [];
    if (violations.length > 0) {
      return blockClaude(formatViolations(violations));
    }
  }

  return passSilent();
}

main().catch((e) => {
  try { diag(`post_edit 顶层异常兜底 passSilent: ${e && e.message ? e.message : e}`); } catch (_) {}
  passSilent();
});
