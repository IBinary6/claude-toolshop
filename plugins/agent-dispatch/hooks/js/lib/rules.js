'use strict';

const SEPARATORS = new Set(['&&', '||', ';', '|', '&']);
const TWO_CHAR_OPERATORS = new Set([
  '&&', '||', '>>', '<<', '&>', '>|', '<>', '>&', '<&',
]);
const ONE_CHAR_OPERATORS = new Set([';', '|', '&', '>', '<']);
const OUTPUT_REDIRECTS = new Set(['>', '>>', '&>', '>|', '<>', '>&']);

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
  if (typeof command !== 'string') return false;

  let quote = null;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && (ch === '`' || command.startsWith('$(', i))) return true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '`' || command.startsWith('$(', i)
        || command.startsWith('<(', i) || command.startsWith('>(', i)) {
      return true;
    }
  }
  return false;
}

function hasAmbiguousCrossShellEscape(command) {
  if (typeof command !== 'string') return false;
  return /\\(?=["'$`;&|><()])|\\\r?\n/.test(command);
}

function tokenize(command) {
  if (typeof command !== 'string') return [];
  const tokens = [];
  let current = '';
  let quote = null;

  const flush = () => {
    if (current) tokens.push(current);
    current = '';
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      flush();
      if (ch === '\r' && command[i + 1] === '\n') i += 1;
      tokens.push(';');
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }

    const pair = command.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(pair)) {
      flush();
      tokens.push(pair);
      i += 1;
      continue;
    }
    if (ONE_CHAR_OPERATORS.has(ch)) {
      flush();
      tokens.push(ch);
      continue;
    }
    current += ch;
  }

  flush();
  return tokens;
}

function splitSegments(tokens) {
  const segments = [[]];
  for (const tok of tokens) {
    if (SEPARATORS.has(tok)) segments.push([]);
    else segments[segments.length - 1].push(tok);
  }
  return segments.filter((s) => s.length > 0);
}

function isDangerousBashSegment(tokens, config) {
  const joined = tokens.join(' ');
  const patterns = config.whitelist.bash_dangerous_patterns || [];
  return patterns.some((pat) => new RegExp(pat).test(joined));
}

function hasOutputRedirect(tokens) {
  return tokens.some((t) => OUTPUT_REDIRECTS.has(t));
}

function executableName(token) {
  const value = String(token || '').replace(/^['"]|['"]$/g, '').replace(/\\/g, '/');
  return value.slice(value.lastIndexOf('/') + 1).toLowerCase();
}

function commandHead(tokens) {
  const cleaned = tokens.filter((token) => !['<', '<<', '>', '>>'].includes(token));
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cleaned[index] || '')) index += 1;

  while (index < cleaned.length) {
    const wrapper = executableName(cleaned[index]);
    if (wrapper === 'command') {
      index += 1;
      continue;
    }
    if (wrapper === 'sudo') {
      index += 1;
      while (String(cleaned[index] || '').startsWith('-')) index += 1;
      continue;
    }
    if (wrapper === 'env') {
      index += 1;
      while (/^(?:-[^=]+|[A-Za-z_][A-Za-z0-9_]*=)/.test(cleaned[index] || '')) index += 1;
      continue;
    }
    break;
  }

  return executableName(cleaned[index]);
}

function classifySegment(tokens, config) {
  if (tokens.length === 0) return 'empty';
  const head = commandHead(tokens);

  if (head === 'git' || head === 'git.exe') {
    // Git 是主代理职责边界，不属于委派分类；授权与破坏性检查交给 Claude 权限层。
    return 'safe';
  }

  if (hasOutputRedirect(tokens)) return 'unsafe';
  if (isDangerousBashSegment(tokens, config)) return 'unsafe';

  return new Set(config.whitelist.bash_safe_heads).has(head) ? 'safe' : 'unsafe';
}

/**
 * 判断复合 Shell 命令是否实际执行 Git，用于禁止子代理接管 Git 操作。
 */
function containsGitCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  return splitSegments(tokenize(command)).some((segment) => {
    const head = commandHead(segment);
    if (head === 'git' || head === 'git.exe') return true;
    if (['bash', 'sh', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh'].includes(head)) {
      const shellCommand = segment.join(' ').replace(/['"]/g, '');
      return /(^|[\s;&|/\\])git(?:\.exe)?(?=$|[\s;&|])/i.test(shellCommand);
    }
    return false;
  });
}

function isSafeBashCommand(command, config) {
  if (typeof command !== 'string' || !command.trim()) return false;
  if (hasCommandSubstitution(command)) return false;
  if (hasAmbiguousCrossShellEscape(command)) return false;

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
  hasAmbiguousCrossShellEscape,
  tokenize,
  splitSegments,
  isDangerousBashSegment,
  classifySegment,
  containsGitCommand,
  isSafeBashCommand,
};
