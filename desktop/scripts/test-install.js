// Headless test of the component installer:  node scripts/test-install.js <manifestUrl> <destDir> [abortAfterMB]
'use strict';
const installer = require('../src/installer');
const [manifestUrl, dest, abortMb] = process.argv.slice(2);
const ctl = new AbortController();
let last = -1;
installer.install({
  manifestUrl, dest, signal: ctl.signal,
  onProgress: (p) => {
    if (p.phase === 'download') {
      if (abortMb && p.doneBytes > Number(abortMb) * 2 ** 20) ctl.abort();
      const pct = p.pct;
      if (pct !== last && pct % 10 === 0) { last = pct; console.log(`download ${pct}% (${(p.doneBytes / 2 ** 20).toFixed(0)} MB) ${p.artifact}`); }
    } else console.log(`${p.phase}: ${p.message || ''}`);
  },
}).then((r) => { console.log('RESULT OK', JSON.stringify(r)); }, (e) => { console.log('RESULT ERROR', e.message); process.exitCode = 1; });
