'use strict';

const { readStdinJson } = require('./lib/stdin');
const { passSilent, diag } = require('./lib/protocol');
const { resolveFilePaths, shouldHandle } = require('./lib/target');
const { recordPendingPaths } = require('./lib/pending_edits');

/**
 * PostToolUse: only record the C++ files touched this round; never rewrite files.
 *
 * Rewriting a file between edits makes Claude's next Edit fail with "file has been modified" and re-read repeatedly;
 * formatting, BOM and cpplint all run together at Stop / SubagentStop (stop_check.js).
 * @returns {Promise<void>}
 * @example
 * // stdin: {"session_id":"s","tool_name":"Edit","tool_input":{"file_path":"/p/a.cpp"}}
 * // -> records /p/a.cpp, stdout stays empty
 */
async function main() {
  const input = await readStdinJson({ timeoutMs: 5000 });
  if (!input) return passSilent();
  // An MCP tool can end with an isError result and still trigger PostToolUse; failed edits are not recorded.
  const result = input.tool_response || {};
  if (result.is_error === true || result.isError === true || result.success === false) {
    return passSilent();
  }

  const filePaths = resolveFilePaths(input).filter(shouldHandle);
  if (filePaths.length > 0 && !recordPendingPaths(input, filePaths)) {
    diag('[cpp-style-enforcer] Could not record the pending C++ files; they will not be normalized automatically at the end of this round');
  }
  return passSilent();
}

main().catch((e) => {
  try { diag(`post_edit recording failed, falling back to passSilent: ${e && e.message ? e.message : e}`); } catch (_) {}
  passSilent();
});
