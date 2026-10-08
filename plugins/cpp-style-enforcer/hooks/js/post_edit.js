'use strict';

const { readStdinJson } = require('./lib/stdin');
const { passSilent, diag } = require('./lib/protocol');
const { resolveFilePaths, shouldHandle } = require('./lib/target');
const { recordPendingPaths } = require('./lib/pending_edits');

/**
 * PostToolUse：只记录本轮触碰的 C++ 文件，不改写文件。
 *
 * 在编辑之间改写文件会让 Claude 后续 Edit 因“文件已被修改”而失败并反复重读；
 * 格式化、BOM、版权头与 cpplint 统一在 Stop / SubagentStop（stop_check.js）执行。
 * @returns {Promise<void>}
 * @example
 * // stdin: {"session_id":"s","tool_name":"Edit","tool_input":{"file_path":"/p/a.cpp"}}
 * // → 记录 /p/a.cpp，stdout 为空
 */
async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return passSilent();
  // MCP 工具可能以 isError 结果结束而仍触发 PostToolUse；失败的编辑不记录。
  const result = input.tool_response || {};
  if (result.is_error === true || result.isError === true || result.success === false) {
    return passSilent();
  }

  const filePaths = resolveFilePaths(input).filter(shouldHandle);
  if (filePaths.length > 0 && !recordPendingPaths(input, filePaths)) {
    diag('[cpp-style-enforcer] 无法记录待处理 C++ 文件，本轮结束时不会自动规范化这些文件');
  }
  return passSilent();
}

main().catch((e) => {
  try { diag(`post_edit 记录异常兜底 passSilent: ${e && e.message ? e.message : e}`); } catch (_) {}
  passSilent();
});
