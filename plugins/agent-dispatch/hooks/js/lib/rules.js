'use strict';

const SEPARATORS = new Set(['&&', '||', ';', '|']);

function isWhitelistedTool(toolName, config) {
  return new Set(config.whitelist.tools).has(toolName);
}

function isWhitelistedMcp(toolName, config) {
  return config.whitelist.mcp_prefixes.some((p) => toolName.startsWith(p));
}

function isMcpBlocked(toolName, config) {
  const blockList = config.whitelist.mcp_block_exact || [];
  return blockList.includes(toolName);
}

function hasCommandSubstitution(command) {
  return /\$\(|`/.test(command);
}

function tokenize(command) {
  if (typeof command !== 'string') return [];
  return command.trim().match(/(?:"[^"]*"|'[^']*'|\S+)/g) || [];
}

function splitSegments(tokens) {
  const segments = [[]];
  for (const tok of tokens) {
    if (SEPARATORS.has(tok)) segments.push([]);
    else segments[segments.length - 1].push(tok);
  }
  return segments.filter((s) => s.length > 0);
}

function isDangerousGit(gitArgs, config) {
  const joined = gitArgs.join(' ');
  return config.whitelist.git_dangerous_patterns.some((pat) => new RegExp(pat).test(joined));
}

function isReadonlyGit(gitArgs, config) {
  return config.whitelist.git_readonly.some((cmd) =>
    cmd.every((tok, i) => gitArgs[i] === tok)
  );
}

function isSafeGitWrite(gitArgs, config) {
  if (gitArgs.length === 0) return false;
  return config.whitelist.git_safe_write.includes(gitArgs[0]);
}

function classifySegment(tokens, config) {
  const cleaned = tokens.filter((t) => !['>', '>>', '<', '<<'].includes(t));
  if (cleaned.length === 0) return 'empty';
  const head = cleaned[0];

  if (head === 'git') {
    const gitArgs = cleaned.slice(1);
    if (gitArgs.length === 0) return 'unsafe';
    if (isDangerousGit(gitArgs, config)) return 'unsafe';
    if (isReadonlyGit(gitArgs, config)) return 'safe';
    if (isSafeGitWrite(gitArgs, config)) return 'safe';
    return 'unsafe';
  }

  return new Set(config.whitelist.bash_safe_heads).has(head) ? 'safe' : 'unsafe';
}

function isSafeBashCommand(command, config) {
  if (typeof command !== 'string' || !command.trim()) return false;
  if (hasCommandSubstitution(command)) return false;

  const tokens = tokenize(command);
  if (tokens.length === 0) return false;

  const segments = splitSegments(tokens);
  if (segments.length === 0) return false;

  return segments.every((seg) => classifySegment(seg, config) === 'safe');
}

module.exports = {
  isWhitelistedTool,
  isWhitelistedMcp,
  isMcpBlocked,
  hasCommandSubstitution,
  tokenize,
  splitSegments,
  isDangerousGit,
  isReadonlyGit,
  isSafeGitWrite,
  classifySegment,
  isSafeBashCommand,
};
