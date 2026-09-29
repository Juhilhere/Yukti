// Self-contained test of src/installer.js (used in CI): builds a tiny fake release (zip + file split into parts),
// serves it with a Range-capable HTTP server, installs it, then checks resume, idempotent re-run and corruption detection.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const installer = require('../src/installer');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yukti-inst-'));
  const site = path.join(tmp, 'site'); const files = path.join(site, 'files'); fs.mkdirSync(files, { recursive: true });
  // server-core.zip containing yukti-server.exe + web/index.html
  const pkg = path.join(tmp, 'pkg'); fs.mkdirSync(path.join(pkg, 'web'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'yukti-server.exe'), 'fake-exe');
  fs.writeFileSync(path.join(pkg, 'web', 'index.html'), '<html></html>');
  const zip = path.join(tmp, 'server-core.zip');
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-a', '-c', '-f', zip, '-C', pkg, 'yukti-server.exe', 'web']);
  const zipBuf = fs.readFileSync(zip);
  fs.writeFileSync(path.join(files, 'server-core.part00'), zipBuf);
  // model file split into 3 parts
  const model = crypto.randomBytes(3 * 1024 * 1024 + 123);
  const parts = [];
  for (let i = 0, off = 0; off < model.length; i++, off += 1024 * 1024) {
    const b = model.subarray(off, Math.min(model.length, off + 1024 * 1024));
    fs.writeFileSync(path.join(files, `model.part0${i}`), b);
    parts.push({ url: `files/model.part0${i}`, size: b.length, sha256: sha(b) });
  }
  const manifest = { product: 'yukti-server', version: '9.9.9', artifacts: [
    { name: 'server-core', kind: 'zip', check: 'yukti-server.exe', size: zipBuf.length, sha256: sha(zipBuf), parts: [{ url: 'files/server-core.part00', size: zipBuf.length, sha256: sha(zipBuf) }] },
    { name: 'llama-cuda', kind: 'zip', check: 'llama/cuda/x', requires: 'nvidia', size: 1, sha256: 'X', parts: [] },
    { name: 'model', kind: 'file', dest: 'models/m.gguf', check: 'models/m.gguf', size: model.length, sha256: sha(model), parts },
  ] };
  fs.writeFileSync(path.join(site, 'manifest.json'), JSON.stringify(manifest));
  let dropAfter = 0;  // simulate a connection drop mid-file on the first request for model part 1
  const srv = http.createServer((req, res) => {
    const f = path.join(site, decodeURIComponent(req.url.split('?')[0]));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const buf = fs.readFileSync(f);
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, { 'Content-Length': buf.length - start, 'Accept-Ranges': 'bytes' });
    if (f.endsWith('model.part01') && dropAfter === 0) { dropAfter = 1; res.write(buf.subarray(start, start + 1000)); return res.destroy(); }
    res.end(buf.subarray(start));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/manifest.json`;
  const dest = path.join(tmp, 'install');
  const r = await installer.install({ manifestUrl: url, dest, forceGpu: false, onProgress: () => {} });
  assert(r.version === '9.9.9', 'install completes (with one dropped connection retried)');
  assert(fs.readFileSync(path.join(dest, 'yukti-server.exe'), 'utf8') === 'fake-exe', 'zip component extracted');
  assert(sha(fs.readFileSync(path.join(dest, 'models', 'm.gguf'))) === sha(model), 'multi-part file reassembled byte-identical');
  assert(!fs.existsSync(path.join(dest, 'llama')), 'NVIDIA-only component skipped on non-NVIDIA PC');
  let plan = '';
  await installer.install({ manifestUrl: url, dest, forceGpu: false, onProgress: (p) => { if (p.phase === 'plan') plan = p.message; } });
  assert(/0 of 2 components/.test(plan), 'second run downloads nothing');
  fs.writeFileSync(path.join(files, 'model.part02'), Buffer.from('tampered'));
  fs.rmSync(path.join(dest, 'models', 'm.gguf'));
  let failed = false;
  try { await installer.install({ manifestUrl: url, dest, forceGpu: false, onProgress: () => {} }); } catch (e) { failed = /Checksum mismatch/.test(e.message); }
  assert(failed, 'tampered download rejected by SHA-256');
  let rel = false;
  try { await installer.install({ manifestUrl: url, dest: 'E:relative', onProgress: () => {} }); } catch (e) { rel = /full path/.test(e.message); }
  assert(rel, 'drive-relative install path rejected');
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('installer self-test passed');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
