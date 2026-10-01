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
  // optional add-on (downloaded only when switched on)
  const voice = crypto.randomBytes(200 * 1024);
  fs.writeFileSync(path.join(files, 'voice.part00'), voice);
  const manifest = { product: 'yukti-server', version: '9.9.9', artifacts: [
    { name: 'voice-model', kind: 'file', feature: 'voice', dest: 'speech/models/v.bin', check: 'speech/models/v.bin', size: voice.length, sha256: sha(voice),
      parts: [{ url: 'files/voice.part00', size: voice.length, sha256: sha(voice) }] },
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
  const pl = await installer.plan({ manifestUrl: url, dest, forceGpu: false });
  assert(pl.todoCount === 2 && pl.wantedCount === 2 && pl.totalBytes === zipBuf.length + model.length, 'plan: 2 components, correct size');
  assert(pl.artifacts.find((x) => x.name === 'llama-cuda').needed === false, 'plan: NVIDIA-only component marked not needed');
  assert(pl.artifacts.find((x) => x.name === 'voice-model').needed === false && pl.features.voice.size === voice.length && !pl.features.voice.on,
    'plan: optional add-on left out of the first download, with its size');
  // pause (abort) mid-download, then resume from the partial file
  const ctl = new AbortController();
  let paused = false;
  try {
    await installer.install({ manifestUrl: url, dest, forceGpu: false, signal: ctl.signal,
      onProgress: (p) => { if (p.phase === 'download' && p.artifact === 'model' && p.doneBytes > zipBuf.length + 1024) ctl.abort(); } });
  } catch (e) { paused = /cancelled/.test(e.message); }
  assert(paused, 'pause (abort) stops the download');
  const pl2 = await installer.plan({ manifestUrl: url, dest, forceGpu: false });
  assert(pl2.todoCount === 1 && pl2.partialBytes > 0, 'plan after pause: core installed, partial model bytes kept');
  // disk space: what is already downloaded is on the disk and is not needed a second time
  assert(installer.neededBytes(1000, 0) === 2100 && installer.neededBytes(1000, 400) === 1700 && installer.neededBytes(0, 0) === 0,
    'disk-space formula: (total - already downloaded) + 1.1 x total');
  assert(pl.needBytes === installer.neededBytes(pl.totalBytes, 0) && pl2.needBytes === installer.neededBytes(pl2.totalBytes, pl2.partialBytes) &&
    pl2.needBytes === Math.ceil(pl2.totalBytes * 11 / 10) + pl2.totalBytes - pl2.partialBytes, 'plan: needed disk space takes the partial bytes into account');
  const states = {};
  const r = await installer.install({ manifestUrl: url, dest, forceGpu: false,
    onProgress: (p) => { if (p.phase === 'artifact') states[p.artifact] = p.state; } });
  assert(r.version === '9.9.9', 'install resumes and completes (with one dropped connection retried)');
  assert(states.model === 'installed' && states['server-core'] === 'installed' && states['llama-cuda'] === 'skipped', 'per-component artifact events');
  assert(fs.readFileSync(path.join(dest, 'yukti-server.exe'), 'utf8') === 'fake-exe', 'zip component extracted');
  assert(sha(fs.readFileSync(path.join(dest, 'models', 'm.gguf'))) === sha(model), 'multi-part file reassembled byte-identical');
  assert(!fs.existsSync(path.join(dest, 'llama')), 'NVIDIA-only component skipped on non-NVIDIA PC');
  let plan = '';
  await installer.install({ manifestUrl: url, dest, forceGpu: false, onProgress: (p) => { if (p.phase === 'plan') plan = p.message; } });
  assert(/0 of 2 components/.test(plan), 'second run downloads nothing');
  // add-on: switched on later, kept on across later runs, removable
  plan = '';
  await installer.install({ manifestUrl: url, dest, forceGpu: false, features: ['voice'], onProgress: (p) => { if (p.phase === 'plan') plan = p.message; } });
  assert(/1 of 3 components/.test(plan) && fs.existsSync(path.join(dest, 'speech', 'models', 'v.bin')), 'add-on downloaded on request (only the add-on)');
  const pf = await installer.plan({ manifestUrl: url, dest, forceGpu: false });
  assert(pf.todoCount === 0 && pf.features.voice.on && pf.features.voice.installed, 'add-on stays on for later updates');
  // a newer release with a new version of the add-on: it is still there and working, so it must never look "not added"
  const voice2 = crypto.randomBytes(1000);
  fs.writeFileSync(path.join(files, 'voice2.part00'), voice2);
  const newer = JSON.parse(JSON.stringify(manifest));
  Object.assign(newer.artifacts[0], { size: voice2.length, sha256: sha(voice2), parts: [{ url: 'files/voice2.part00', size: voice2.length, sha256: sha(voice2) }] });
  const pu = await installer.plan({ manifest: newer, dest, forceGpu: false });
  assert(pu.features.voice.on && pu.features.voice.present && !pu.features.voice.installed && pu.features.voice.sizeTodo === voice2.length,
    'add-on with a pending update: still present (not offered as "Add"), update size known');
  // no internet: what was added is known from this computer alone
  const lf = await installer.localFeatures(dest);
  assert(lf.voice && lf.voice.on && lf.voice.present && !lf.vision, 'offline: added abilities known without the manifest');
  // a network that never answers must not leave the add-on screen waiting for ever
  const silent = http.createServer(() => { /* never answers */ }).listen(0, '127.0.0.1');
  await new Promise((r) => silent.once('listening', r));
  let hung = '';
  const t0 = Date.now();
  try { await installer.fetchManifest(`http://127.0.0.1:${silent.address().port}/manifest.json`, null, 500); } catch (e) { hung = e.message; }
  assert(/fetch failed/.test(hung) && Date.now() - t0 < 5000, 'manifest download gives up with a network error when nothing answers');
  silent.closeAllConnections(); silent.close();
  await installer.removeFeature(dest, 'voice');
  const pr = await installer.plan({ manifestUrl: url, dest, forceGpu: false });
  assert(!fs.existsSync(path.join(dest, 'speech', 'models', 'v.bin')) && !pr.features.voice.on && pr.todoCount === 0, 'add-on removed and switched off');
  assert(fs.existsSync(path.join(dest, 'yukti-server.exe')), 'removing an add-on keeps Yukti itself');
  // Every download goes through the fetch that is handed in (the app passes Electron's net.fetch: Windows proxy and
  // certificate store). And a complete file left in .download by an earlier run - checked, but not yet put in place -
  // is used as it is instead of being downloaded again.
  const seen = [];
  const countingFetch = (u, init) => { seen.push(String(u)); return fetch(u, init); };
  const dest2 = path.join(tmp, 'install2');
  fs.mkdirSync(path.join(dest2, '.download'), { recursive: true });
  fs.writeFileSync(path.join(dest2, '.download', 'model'), model);
  const pw = await installer.plan({ manifestUrl: url, dest: dest2, forceGpu: false, fetch: countingFetch });
  assert(seen.length === 1 && /manifest\.json$/.test(seen[0]), 'injected fetch: used for the manifest');
  assert(pw.artifacts.find((x) => x.name === 'model').partialBytes === model.length && pw.needBytes === installer.neededBytes(pw.totalBytes, model.length),
    'plan: a complete file in .download counts as already downloaded');
  seen.length = 0;
  await installer.install({ manifestUrl: url, dest: dest2, forceGpu: false, fetch: countingFetch });
  assert(seen.some((u) => /server-core\.part00$/.test(u)), 'injected fetch: used for the parts');
  assert(!seen.some((u) => /model\.part/.test(u)) && sha(fs.readFileSync(path.join(dest2, 'models', 'm.gguf'))) === sha(model),
    'verified whole file in .download reused (not downloaded again), installed byte-identical');
  // …but a leftover with the right size and the wrong content is not trusted
  const dest3 = path.join(tmp, 'install3');
  fs.mkdirSync(path.join(dest3, '.download'), { recursive: true });
  fs.writeFileSync(path.join(dest3, '.download', 'model'), crypto.randomBytes(model.length));
  seen.length = 0;
  await installer.install({ manifestUrl: url, dest: dest3, forceGpu: false, fetch: countingFetch });
  assert(seen.some((u) => /model\.part00$/.test(u)) && sha(fs.readFileSync(path.join(dest3, 'models', 'm.gguf'))) === sha(model),
    'damaged whole file in .download discarded and downloaded again');
  fs.writeFileSync(path.join(files, 'model.part02'), Buffer.from('tampered'));
  fs.rmSync(path.join(dest, 'models', 'm.gguf'));
  let failed = false;
  try { await installer.install({ manifestUrl: url, dest, forceGpu: false, onProgress: () => {} }); } catch (e) { failed = /Checksum mismatch/.test(e.message); }
  assert(failed, 'tampered download rejected by SHA-256');
  let rel = false;
  try { await installer.install({ manifestUrl: url, dest: 'E:relative', onProgress: () => {} }); } catch (e) { rel = /full path/.test(e.message); }
  assert(rel, 'drive-relative install path rejected');
  // release signing: a signed manifest installs; a missing or wrong signature is refused
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const mpath = path.join(site, 'manifest.json');
  let sigErr = '';
  try { await installer.plan({ manifestUrl: url, publicKey: pub, dest, forceGpu: false }); } catch (e) { sigErr = e.message; }
  assert(/signature missing/.test(sigErr), 'unsigned release refused when the app has a publisher key');
  fs.writeFileSync(mpath + '.sig', crypto.sign(null, fs.readFileSync(mpath), privateKey).toString('base64'));
  const ps = await installer.plan({ manifestUrl: url, publicKey: pub, dest, forceGpu: false });
  assert(ps.version === '9.9.9', 'correctly signed release accepted');
  fs.writeFileSync(mpath, fs.readFileSync(mpath, 'utf8').replace('9.9.9', '9.9.8'));
  sigErr = '';
  try { await installer.plan({ manifestUrl: url, publicKey: pub, dest, forceGpu: false }); } catch (e) { sigErr = e.message; }
  assert(/signature is invalid/.test(sigErr), 'tampered manifest refused (signature check)');
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('installer self-test passed');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
