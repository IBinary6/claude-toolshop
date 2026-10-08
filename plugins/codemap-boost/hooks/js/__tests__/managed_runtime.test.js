'use strict';

// ABOUTME: 内置 CRG / Serena 的契约：.mcp.json 与启动器一致、hook 能匹配 Claude 实际的插件工具名、
// ABOUTME: 私有环境的解析与回退、预装钩子的静默条件。全程不联网、不安装。

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.join(__dirname, '..', '..', '..');
const isWindows = process.platform === 'win32';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-managed-'));

function withData(dir, fn) {
  const old = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try {
    delete require.cache[require.resolve('../lib/managed_runtime')];
    return fn(require('../lib/managed_runtime'));
  } finally {
    if (old === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = old;
  }
}

try {
  // ---- .mcp.json：两个服务都经同一个启动器，且启动器文件真实存在 ----
  const mcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8')).mcpServers;
  assert.deepStrictEqual(Object.keys(mcp).sort(), ['code-review-graph', 'serena']);
  for (const [name, server] of Object.entries(mcp)) {
    assert.strictEqual(server.command, 'node', `${name} 用 node 启动，不依赖全局 CLI`);
    assert.ok(server.args[0].startsWith('${CLAUDE_PLUGIN_ROOT}/scripts/'), `${name} 必须用 CLAUDE_PLUGIN_ROOT 定位启动器`);
    assert.ok(fs.existsSync(path.join(pluginRoot, server.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))), `${name} 启动器必须存在`);
  }
  assert.strictEqual(mcp['code-review-graph'].args[1], 'crg');
  assert.strictEqual(mcp.serena.args[1], 'serena');

  // ---- hook matcher 必须匹配 Claude 对插件 MCP 的真实命名 mcp__plugin_<插件>_<服务>__<工具> ----
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const graphTool = 'mcp__plugin_codemap-boost_code-review-graph__query_graph_tool';
  for (const event of ['PreToolUse']) {
    const matcher = hooks[event].find((e) => e.hooks.some((h) => h.command.includes('pre_graph_tool.js')));
    assert.ok(matcher, '图工具读前屏障必须注册');
    assert.ok(new RegExp(matcher.matcher).test(graphTool), `屏障 matcher 必须匹配 ${graphTool}`);
  }

  // ---- 私有 CRG 的解析：未安装回退 PATH，安装后用私有路径，并被 commandExists 识别 ----
  withData(dataDir, (rt) => {
    assert.strictEqual(rt.crgCommand(), 'code-review-graph', '未安装时回退 PATH 命令名');
    const crg = rt.crgPaths();
    assert.ok(crg.command.startsWith(dataDir), '私有 CRG 必须装在插件数据目录');
    assert.notStrictEqual(rt.crgPaths().dir, rt.serenaPaths().dir, 'CRG 与 Serena 必须使用各自独立的 venv');
    assert.ok(rt.serenaPaths().dir.includes(rt.SERENA_VERSION), 'Serena venv 按固定版本隔离');
    assert.ok(rt.SERENA_MCP_ARGS.includes('--project-from-cwd'), 'Serena 应按会话 cwd 自动激活项目');
    assert.ok(!rt.CRG_PACKAGE.includes('all'), '不带 embeddings，避免 serve 启动预热超过 MCP 30s 超时');

    fs.mkdirSync(path.dirname(crg.command), { recursive: true });
    fs.writeFileSync(crg.command, '');
    assert.strictEqual(rt.crgCommand(), crg.command, '安装后使用私有路径');
    const utils = require('../lib/utils');
    delete require.cache[require.resolve('../lib/utils')];
    assert.strictEqual(require('../lib/utils').commandExists('code-review-graph'), true, 'hook 认私有环境为已安装');
    void utils;
  });

  // ---- 回归：私有 CRG 路径含空格时，刷新必须真能执行它（曾因 cmd /c 引号转义报 "not recognized"）----
  {
    const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb dir with space-'));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-repo-'));
    const marker = path.join(repo, 'ran.txt');
    const { crgRefreshFor } = (() => {
      return withData(spaced, (rt) => {
        // 用 node 本体充当桩 CRG：`node update --repo <cwd>` 会把 cwd 下名为 update 的文件当脚本执行。
        fs.mkdirSync(path.dirname(rt.crgPaths().command), { recursive: true });
        fs.copyFileSync(process.execPath, rt.crgPaths().command);
        fs.writeFileSync(path.join(repo, 'update'), `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '));`);
        delete require.cache[require.resolve('../lib/crg_refresh')];
        return { crgRefreshFor: require('../lib/crg_refresh') };
      });
    })();
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const old = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = spaced;
    try {
      const r = crgRefreshFor.runCrgRefresh(repo, 'update', null);
      assert.strictEqual(r.success, true, '含空格的私有 CRG 路径必须可执行');
      assert.ok(fs.existsSync(marker), '桩 CRG 必须真的被运行');
    } finally {
      if (old === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = old;
      fs.rmSync(spaced, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  // ---- 启动器：未知服务名明确失败，诊断走 stderr、stdout 保持干净 ----
  const launch = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'mcp-launch.cjs'), 'nope'], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
  });
  assert.notStrictEqual(launch.status, 0);
  assert.strictEqual(launch.stdout, '', 'stdout 只留给 MCP 协议');
  assert.match(launch.stderr, /未知服务/);

  // ---- 预装钩子：已安装 → 静默；开关关闭 → 静默（不会联网安装）----
  const boot = path.join(pluginRoot, 'hooks', 'js', 'runtime_bootstrap', 'runtime_bootstrap.js');
  const quick = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-quick-'));
  withData(quick, (rt) => {
    for (const p of [rt.crgPaths().command, rt.serenaPaths().command]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '');
    }
  });
  const installed = spawnSync(process.execPath, [boot], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: quick } });
  assert.strictEqual(installed.stdout, '', '两个环境都在时不打扰');
  const off = spawnSync(process.execPath, [boot], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir + '-none', CODEMAP_BOOST_NO_BOOTSTRAP: '1' },
  });
  assert.strictEqual(off.stdout, '', 'NO_BOOTSTRAP 开关下不拉起安装');
  fs.rmSync(quick, { recursive: true, force: true });
  void isWindows;

  console.log('managed_runtime.test.js PASS');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
