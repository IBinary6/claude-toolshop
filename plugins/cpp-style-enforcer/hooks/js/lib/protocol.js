'use strict';

/**
 * The only output exit. Iron rules: always exit 0; diagnostics go to stderr; stdout is either empty or pure JSON.
 * Never exit 1 (issue #4809) and never exit 2 with stdout JSON (the old crash source).
 */

/** Pass silently: stdout and stderr stay empty, exit 0. */
function passSilent() {
  process.exit(0);
}

/**
 * PreToolUse deny: exit 0 + stdout hookSpecificOutput.permissionDecision=deny
 * @param {string} reason The reason for blocking.
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

/** Diagnostics (visible to the user and Claude); never mixed into stdout. */
function diag(message) {
  process.stderr.write(String(message) + '\n');
}

module.exports = { passSilent, denyTool, diag };
