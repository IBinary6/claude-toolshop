'use strict';

/**
 * 唯一输出出口。铁律：全程 exit 0；诊断走 stderr；stdout 要么空要么纯 JSON。
 * 永不 exit 1（issue #4809）、永不 exit 2+stdout JSON（旧崩溃源）。
 */

/** 静默通过：stdout/stderr 均空，exit 0 */
function passSilent() {
  process.exit(0);
}

/**
 * PreToolUse 阻止工具：exit 0 + stdout hookSpecificOutput.permissionDecision=deny
 * @param {string} reason 阻止理由
 */
function denyTool(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

/** 诊断信息（用户/Claude 可见），绝不混入 stdout */
function diag(message) {
  process.stderr.write(String(message) + '\n');
}

module.exports = { passSilent, denyTool, diag };
