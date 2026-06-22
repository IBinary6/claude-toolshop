'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

/**
 * 从 hook 输入推导项目 cwd，用于项目配置和临时 marker 隔离。
 */
function hookCwd(input) {
  return (input && typeof input.cwd === 'string' && input.cwd)
    || process.env.CLAUDE_WORKING_DIRECTORY
    || process.cwd();
}

/**
 * 生成会话/项目级 block marker，避免不同仓库或会话之间串提示。
 */
function blockedMarkerPath(input) {
  const cwd = hookCwd(input);
  const sessionId = (input && (input.session_id || input.sessionId)) || '';
  const key = crypto.createHash('sha1')
    .update(`${sessionId}\n${path.resolve(cwd)}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `.agent-dispatch-blocked-${key}`);
}

module.exports = { blockedMarkerPath, hookCwd };
