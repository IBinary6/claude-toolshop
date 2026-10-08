'use strict';

// ABOUTME: 后台预装 CRG 与 Serena 私有环境（SessionStart 拉起，也可手动运行）。
// ABOUTME: 用法：node ensure-runtime.cjs [--doctor]；--doctor 只读检查，不安装。

const rt = require('../hooks/js/lib/managed_runtime');

function main() {
  if (process.argv[2] === '--doctor') {
    const report = {
      dataDir: rt.dataDir(),
      crg: { ok: rt.probeCrg(), command: rt.crgPaths().command, failure: rt.readFailure('.crg-install-failed') },
      serena: { ok: rt.probeSerena(), command: rt.serenaPaths().command, failure: rt.readFailure('.serena-install-failed') },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.crg.ok && report.serena.ok ? 0 : 1;
    return;
  }
  const crg = rt.ensureCrg();
  const serena = rt.ensureSerena();
  process.stderr.write(`[codemap-boost] 私有运行环境：code-review-graph=${crg ? 'ok' : 'failed'} serena=${serena ? 'ok' : 'failed'}\n`);
  process.exitCode = crg && serena ? 0 : 1;
}

main();
