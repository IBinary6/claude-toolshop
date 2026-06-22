'use strict';
const assert = require('assert').strict;
const path = require('path');

const {
  isWhitelistedTool,
  isWhitelistedMcp,
  isMcpBlocked,
  hasCommandSubstitution,
  tokenize,
  splitSegments,
  isDangerousGit,
  isDangerousBashSegment,
  isReadonlyGit,
  isSafeGitWrite,
  classifySegment,
  isSafeBashCommand,
} = require('../lib/rules');

const { loadDefaults, mergeConfig } = require('../lib/config');
const config = loadDefaults();

// --- isWhitelistedTool ---
assert.equal(isWhitelistedTool('Agent', config), true);
assert.equal(isWhitelistedTool('Read', config), true);
assert.equal(isWhitelistedTool('Grep', config), true);
assert.equal(isWhitelistedTool('Edit', config), true);
assert.equal(isWhitelistedTool('Write', config), true);
assert.equal(isWhitelistedTool('Bash', config), false);
assert.equal(isWhitelistedTool('UnknownTool', config), false);
assert.equal(isWhitelistedTool('mcp__context7__query', config), false);

// --- isWhitelistedMcp ---
assert.equal(isWhitelistedMcp('mcp__plugin_context-mode_ctx_execute', config), true);
assert.equal(isWhitelistedMcp('mcp__plugin_claude-mem_search', config), true);
assert.equal(isWhitelistedMcp('mcp__sequential-thinking_think', config), true);
assert.equal(isWhitelistedMcp('mcp__code_review_graph__get_minimal_context_tool', config), true);
assert.equal(isWhitelistedMcp('mcp__code-review-graph__get_minimal_context_tool', config), true);
assert.equal(isWhitelistedMcp('mcp__code-review-graph__semantic_search_nodes_tool', config), true);
assert.equal(isWhitelistedMcp('mcp__codegraph__search', config), true);
assert.equal(isWhitelistedMcp('mcp__codegraph__context', config), true);
assert.equal(isWhitelistedMcp('mcp__graphify__query', config), true);
assert.equal(isWhitelistedMcp('mcp__graphify__build', config), true);
assert.equal(isWhitelistedMcp('mcp__context7__query-docs', config), false);
assert.equal(isWhitelistedMcp('mcp__tavily-cross-platform__search', config), false);
assert.equal(isWhitelistedMcp('mcp__deepwiki__fetch', config), false);

// --- isMcpBlocked (通用精确 deny 名单) ---
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_execute', config), true);
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_execute_file', config), true);
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_batch_execute', config), true);
// 只读/元数据类不在 deny 名单
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_search', config), false);
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_index', config), false);
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_stats', config), false);
assert.equal(isMcpBlocked('mcp__plugin_context-mode_context-mode__ctx_fetch_and_index', config), false);
// 其他 MCP 工具不受影响
assert.equal(isMcpBlocked('mcp__tavily-cross-platform__search', config), false);
assert.equal(isMcpBlocked('mcp__plugin_claude-mem_search', config), false);
assert.equal(isMcpBlocked('mcp__code_review_graph__get_minimal_context_tool', config), false);
assert.equal(isMcpBlocked('mcp__codegraph__context', config), false);
// 前缀匹配仍然返回 true（deny 优先逻辑在 enforcer 中实现）
assert.equal(isWhitelistedMcp('mcp__plugin_context-mode_context-mode__ctx_execute', config), true);

// --- hasCommandSubstitution ---
assert.equal(hasCommandSubstitution('echo hello'), false);
assert.equal(hasCommandSubstitution('echo $(whoami)'), true);
assert.equal(hasCommandSubstitution('echo `whoami`'), true);
assert.equal(hasCommandSubstitution('git status'), false);

// --- tokenize ---
assert.deepEqual(tokenize('git status'), ['git', 'status']);
assert.deepEqual(tokenize('echo "hello world"'), ['echo', '"hello world"']);
assert.deepEqual(tokenize("echo 'single quotes'"), ['echo', "'single quotes'"]);
assert.deepEqual(tokenize(''), []);
assert.deepEqual(tokenize(null), []);
assert.deepEqual(tokenize(undefined), []);

// --- splitSegments ---
assert.deepEqual(splitSegments(['git', 'status', '&&', 'echo', 'done']), [['git', 'status'], ['echo', 'done']]);
assert.deepEqual(splitSegments(['ls', '|', 'grep', 'foo']), [['ls'], ['grep', 'foo']]);
assert.deepEqual(splitSegments(['echo', 'hi']), [['echo', 'hi']]);
assert.deepEqual(splitSegments(['cmd1', '||', 'cmd2', ';', 'cmd3']), [['cmd1'], ['cmd2'], ['cmd3']]);

// --- isDangerousGit ---
assert.equal(isDangerousGit(['push', '--force'], config), true);
assert.equal(isDangerousGit(['push', '-f'], config), true);
assert.equal(isDangerousGit(['reset', '--hard'], config), true);
assert.equal(isDangerousGit(['branch', '-D', 'feature'], config), true);
assert.equal(isDangerousGit(['clean', '-fdx'], config), true);
assert.equal(isDangerousGit(['checkout', '--', '.'], config), true);
assert.equal(isDangerousGit(['restore', '--', '.'], config), true);
assert.equal(isDangerousGit(['push', 'origin', 'main'], config), false);
assert.equal(isDangerousGit(['commit', '-m', 'msg'], config), false);
assert.equal(isDangerousGit(['reset', '--soft', 'HEAD~1'], config), false);
assert.equal(isDangerousGit(['clean', '-f'], config), true);

// --- isDangerousBashSegment ---
assert.equal(isDangerousBashSegment(['rm', '-rf', '/tmp/x'], config), true);
assert.equal(isDangerousBashSegment(['docker', 'rm', '-f', 'prod'], config), true);
assert.equal(isDangerousBashSegment(['kubectl', 'delete', 'pod', 'x'], config), true);
assert.equal(isDangerousBashSegment(['helm', 'uninstall', 'prod'], config), true);
assert.equal(isDangerousBashSegment(['docker', 'ps'], config), false);

// --- isReadonlyGit ---
assert.equal(isReadonlyGit(['status'], config), true);
assert.equal(isReadonlyGit(['diff'], config), true);
assert.equal(isReadonlyGit(['log'], config), true);
assert.equal(isReadonlyGit(['remote', '-v'], config), true);
assert.equal(isReadonlyGit(['config', '--get'], config), true);
assert.equal(isReadonlyGit(['stash', 'list'], config), true);
assert.equal(isReadonlyGit(['commit'], config), false);
assert.equal(isReadonlyGit(['push'], config), false);

// --- isSafeGitWrite ---
assert.equal(isSafeGitWrite(['add', '.'], config), true);
assert.equal(isSafeGitWrite(['commit', '-m', 'test'], config), true);
assert.equal(isSafeGitWrite(['push', 'origin', 'main'], config), false);
assert.equal(isSafeGitWrite(['merge', 'feature'], config), false);
assert.equal(isSafeGitWrite([], config), false);
assert.equal(isSafeGitWrite(['unknown-subcmd'], config), false);

// --- classifySegment ---
assert.equal(classifySegment(['ls', '-la'], config), 'safe');
assert.equal(classifySegment(['fd', '--type', 'f'], config), 'safe');
assert.equal(classifySegment(['git', 'status'], config), 'safe');
assert.equal(classifySegment(['git', 'commit', '-m', 'msg'], config), 'safe');
assert.equal(classifySegment(['git', 'push', '--force'], config), 'unsafe');
assert.equal(classifySegment(['rm', '-rf', '/tmp/x'], config), 'unsafe');
assert.equal(classifySegment(['echo', 'hi', '>', 'file.txt'], config), 'unsafe');
assert.equal(classifySegment(['git'], config), 'unsafe');
assert.equal(classifySegment(['npm', 'test'], config), 'safe');
assert.equal(classifySegment(['python', 'script.py'], config), 'safe');
assert.equal(classifySegment(['codegraph', 'sync'], config), 'safe');
assert.equal(classifySegment(['codegraph', 'status'], config), 'safe');
assert.equal(classifySegment(['code-review-graph', 'status'], config), 'safe');
assert.equal(classifySegment(['graphify', '--version'], config), 'safe');
assert.equal(classifySegment(['env', 'rm', '-rf', '/tmp/x'], config), 'unsafe');
assert.equal(classifySegment([], config), 'empty');

// --- isSafeBashCommand ---
assert.equal(isSafeBashCommand('ls -la', config), true);
assert.equal(isSafeBashCommand('git status', config), true);
assert.equal(isSafeBashCommand('git log --oneline', config), true);
assert.equal(isSafeBashCommand('fd -t f . && rg pattern', config), true);
assert.equal(isSafeBashCommand('git add . && git commit -m "test"', config), true);
assert.equal(isSafeBashCommand('ls | grep foo | wc -l', config), true);
assert.equal(isSafeBashCommand('git push --force', config), false);
assert.equal(isSafeBashCommand('git clean -f', config), false);
assert.equal(isSafeBashCommand('rm -rf /tmp/x', config), false);
assert.equal(isSafeBashCommand('docker rm -f prod', config), false);
assert.equal(isSafeBashCommand('kubectl delete pod x', config), false);
assert.equal(isSafeBashCommand('echo hi > file.txt', config), false);
assert.equal(isSafeBashCommand('npm test', config), true);
assert.equal(isSafeBashCommand('codegraph sync && graphify --version', config), true);
assert.equal(isSafeBashCommand('echo $(whoami)', config), false);
assert.equal(isSafeBashCommand('python script.py', config), true);
assert.equal(isSafeBashCommand('codegraph status && code-review-graph status', config), true);
assert.equal(isSafeBashCommand('graphify --version', config), true);
assert.equal(isSafeBashCommand('env rm -rf /tmp/x', config), false);
assert.equal(isSafeBashCommand('env kubectl delete pod x', config), false);
assert.equal(isSafeBashCommand('printenv', config), true);
assert.equal(isSafeBashCommand('safe && npm run build', config), false);
assert.equal(isSafeBashCommand('', config), false);
assert.equal(isSafeBashCommand(null, config), false);
assert.equal(isSafeBashCommand(undefined, config), false);

// --- mergeConfig override filter ---
{
  const merged = mergeConfig(config, {
    modules: { prompt_inject: false },
    overrides: {
      tools_add: ['CustomTool', 'Read'],
      tools_remove: ['WebSearch'],
      mcp_prefixes_add: ['mcp__custom_', 'mcp__code_review_graph__'],
      mcp_prefixes_remove: ['mcp__sequential-thinking'],
      mcp_block_exact_add: ['mcp__custom__danger'],
      mcp_block_exact_remove: ['mcp__plugin_context-mode_context-mode__ctx_execute'],
      bash_heads_add: ['custom-cli', 'npm'],
      bash_heads_remove: ['rm']
    }
  });
  assert.equal(merged.modules.prompt_inject, false);
  assert.equal(merged.whitelist.tools.includes('CustomTool'), true);
  assert.equal(merged.whitelist.tools.includes('WebSearch'), false);
  assert.equal(merged.whitelist.tools.filter((t) => t === 'Read').length, 1);
  assert.equal(merged.whitelist.mcp_prefixes.includes('mcp__custom_'), true);
  assert.equal(merged.whitelist.mcp_prefixes.includes('mcp__sequential-thinking'), false);
  assert.equal(merged.whitelist.mcp_prefixes.filter((p) => p === 'mcp__code_review_graph__').length, 1);
  assert.equal(merged.whitelist.mcp_block_exact.includes('mcp__custom__danger'), true);
  assert.equal(merged.whitelist.mcp_block_exact.includes('mcp__plugin_context-mode_context-mode__ctx_execute'), false);
  assert.equal(merged.whitelist.bash_safe_heads.includes('custom-cli'), true);
  assert.equal(merged.whitelist.bash_safe_heads.includes('rm'), false);
  assert.equal(merged.whitelist.bash_safe_heads.filter((h) => h === 'npm').length, 1);
}

console.log('✓ rules.test.js — all assertions passed');
