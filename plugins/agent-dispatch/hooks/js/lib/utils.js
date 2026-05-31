'use strict';

function readStdinJson(opts = {}) {
  const { timeoutMs = 5000 } = opts;
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(null); });
    process.stdin.resume();
  });
}

function output(obj) {
  console.log(JSON.stringify(obj));
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

module.exports = { readStdinJson, output, log };
