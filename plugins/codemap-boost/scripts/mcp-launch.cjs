'use strict';

// ABOUTME: .mcp.json 的 stdio 启动器：确保插件私有 CRG / Serena 环境就绪后再启动对应 MCP 服务。
// ABOUTME: stdout 只用于 MCP 协议，诊断一律写 stderr。用法：node mcp-launch.cjs <crg|serena>

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const rt = require('../hooks/js/lib/managed_runtime');

/**
 * 按服务名准备启动命令；环境缺失时同步安装（首次可能数分钟，SessionStart 已提前后台预装）。
 * @param {'crg'|'serena'} name
 * @returns {{ok:boolean, command?:string, args?:string[], env?:object, diagnostic?:string}}
 * @example
 * prepare('crg') // { ok: true, command: '<data>/crg-runtime/bin/code-review-graph', args: ['serve'] }
 */
function prepare(name) {
  if (name === 'crg') {
    if (!rt.ensureCrg()) return { ok: false, diagnostic: rt.readFailure('.crg-install-failed') || 'code-review-graph 私有环境不可用' };
    return { ok: true, command: rt.crgPaths().command, args: ['serve'], env: process.env };
  }
  if (name === 'serena') {
    if (!rt.ensureSerena()) return { ok: false, diagnostic: rt.readFailure('.serena-install-failed') || 'Serena 私有环境不可用' };
    const home = rt.serenaPaths().home;
    fs.mkdirSync(home, { recursive: true });
    return { ok: true, command: rt.serenaPaths().command, args: rt.SERENA_MCP_ARGS, env: { ...process.env, SERENA_HOME: home } };
  }
  return { ok: false, diagnostic: `未知服务：${name}（只支持 crg / serena）` };
}

function main() {
  // MCP 常驻进程不能以会被插件更新替换的缓存目录为工作目录；cwd 仍由 Claude Code 决定项目，故不 chdir 到别处。
  const prepared = prepare(process.argv[2]);
  if (!prepared.ok) {
    process.stderr.write(`[codemap-boost] ${prepared.diagnostic}\n`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(prepared.command, prepared.args, {
    cwd: process.cwd(), env: prepared.env, stdio: 'inherit', windowsHide: process.platform === 'win32',
  });
  child.once('error', (e) => { process.stderr.write(`[codemap-boost] 启动失败：${e.message}\n`); process.exitCode = 1; });
  child.once('exit', (code) => { process.exitCode = Number.isInteger(code) ? code : 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { try { child.kill(signal); } catch (_) {} });
}

if (require.main === module) main();

module.exports = { prepare, scriptDir: path.resolve(__dirname) };
