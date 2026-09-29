// Yukti component installer — downloads the Yukti Server package from the publisher's website using a signed-off manifest,
// with resume (HTTP Range), per-part and per-artifact SHA-256 verification, GPU-aware selection and zip extraction.
// Plain Node (no Electron APIs) so it can be tested headlessly: see scripts/test-install.js.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex').toUpperCase()));
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 2 ** 20, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout));
  });
}

async function hasNvidiaGpu() {
  try {
    const out = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name -join ";"']);
    return /nvidia/i.test(out);
  } catch { return false; }
}

async function freeBytes(dir) {
  try {
    const drive = path.parse(path.resolve(dir)).root.replace(/\\$/, '');
    const out = await run('powershell', ['-NoProfile', '-Command', `(Get-PSDrive -Name '${drive[0]}').Free`]);
    return Number(String(out).trim()) || null;
  } catch { return null; }
}

async function fetchManifest(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Cannot download manifest (${r.status}) from ${url}`);
  const m = await r.json();
  if (!m || m.product !== 'yukti-server' || !Array.isArray(m.artifacts)) throw new Error('Not a Yukti release manifest');
  return m;
}

function resolveUrl(base, rel) { return new URL(rel, base).toString(); }

// Download one part with resume. Returns bytes written.
async function downloadPart(url, dest, expectedSize, onBytes, signal) {
  let have = 0;
  try { have = (await fsp.stat(dest)).size; } catch { /* new */ }
  if (have === expectedSize) return 0;
  if (have > expectedSize) { await fsp.rm(dest, { force: true }); have = 0; }
  const headers = have ? { Range: `bytes=${have}-` } : {};
  const r = await fetch(url, { headers, signal, cache: 'no-store' });
  if (have && r.status === 200) { await fsp.rm(dest, { force: true }); have = 0; }       // server ignored Range → restart part
  else if (!r.ok && r.status !== 206) throw new Error(`Download failed (${r.status}) ${url}`);
  const out = fs.createWriteStream(dest, { flags: have ? 'a' : 'w' });
  // Count bytes inside the pipeline (a separate 'data' listener can race with pipeline and drop chunks).
  const counter = new Transform({ transform(chunk, _enc, cb) { onBytes(chunk.length); cb(null, chunk); } });
  await pipeline(Readable.fromWeb(r.body), counter, out);
  return (await fsp.stat(dest)).size - have;
}

async function extractZip(zip, into) {
  await fsp.mkdir(into, { recursive: true });
  // Windows 10/11 ship bsdtar (tar.exe), which extracts zip archives quickly without extra dependencies.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  await run(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', into]);
}

/**
 * Install or update the Yukti Server from a manifest.
 * @param {object} o {manifestUrl, dest, onProgress({phase, artifact, doneBytes, totalBytes, pct, message}), signal, forceGpu}
 */
async function install(o) {
  const report = (x) => o.onProgress && o.onProgress(x);
  report({ phase: 'manifest', message: `Reading release manifest from ${o.manifestUrl}` });
  // Require a full absolute path (e.g. C:\Yukti\Server); reject drive-relative ("E:folder") or relative paths.
  if (!/^[A-Za-z]:[\\/]/.test(String(o.dest || '')) && !String(o.dest || '').startsWith('\\\\')) {
    throw new Error(`Install folder must be a full path such as C:\\Yukti\\Server (got "${o.dest}")`);
  }
  const m = await fetchManifest(o.manifestUrl);
  const dest = path.resolve(o.dest);
  const tmp = path.join(dest, '.download');
  await fsp.mkdir(tmp, { recursive: true });
  const nvidia = o.forceGpu !== undefined ? o.forceGpu : await hasNvidiaGpu();
  const stateFile = path.join(dest, 'installed.json');
  let state = { version: null, artifacts: {} };
  try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { /* fresh */ }

  const wanted = m.artifacts.filter((a) => !(a.requires === 'nvidia' && !nvidia));
  const todo = wanted.filter((a) => state.artifacts[a.name] !== a.sha256 || !fs.existsSync(path.join(dest, a.check || a.dest)));
  const total = todo.reduce((s, a) => s + a.size, 0);
  report({ phase: 'plan', dest, message: `Yukti ${m.version} → ${dest}: ${todo.length} of ${wanted.length} components to download (${(total / 2 ** 30).toFixed(2)} GB)` +
    (nvidia ? ' · NVIDIA GPU detected (CUDA build)' : ' · no NVIDIA GPU (Vulkan/CPU build)'), totalBytes: total });
  const free = await freeBytes(dest);
  if (free !== null && free < total * 2.1) throw new Error(`Not enough disk space on ${path.parse(dest).root}: need ~${(total * 2.1 / 2 ** 30).toFixed(1)} GB, have ${(free / 2 ** 30).toFixed(1)} GB`);

  let completed = 0;   // bytes of verified parts
  let current = 0;     // bytes of the part being downloaded (incl. resumed bytes)
  let lastReport = 0;
  const progress = (a, force) => {
    const now = Date.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    const d = completed + current;
    report({ phase: 'download', artifact: a.name, doneBytes: d, totalBytes: total, pct: total ? Math.min(100, Math.round(100 * d / total)) : 100 });
  };
  for (const a of todo) {
    const partFiles = [];
    for (let i = 0; i < a.parts.length; i++) {
      const p = a.parts[i];
      const pf = path.join(tmp, `${a.name}.part${i}`);
      partFiles.push(pf);
      let tries = 0;
      for (;;) {
        try {
          current = Math.min((await fsp.stat(pf).catch(() => ({ size: 0 }))).size, p.size);
          progress(a, true);
          await downloadPart(resolveUrl(o.manifestUrl, p.url), pf, p.size, (n) => { current += n; progress(a); }, o.signal);
          const h = await sha256File(pf);
          if (h !== p.sha256.toUpperCase()) { await fsp.rm(pf, { force: true }); throw new Error(`Checksum mismatch in ${a.name} part ${i + 1}`); }
          completed += p.size; current = 0; progress(a, true);
          break;
        } catch (e) {
          if (o.signal && o.signal.aborted) throw new Error('Installation cancelled — run Install again to resume');
          if (++tries >= 3) throw e;
          report({ phase: 'retry', artifact: a.name, message: `${e.message} — retrying (${tries}/3)` });
          await new Promise((r) => setTimeout(r, 2000 * tries));
        }
      }
    }
    // join parts → verify whole artifact
    report({ phase: 'verify', artifact: a.name, message: `Verifying ${a.name}` });
    const whole = path.join(tmp, a.name + (a.kind === 'zip' ? '.zip' : ''));
    if (partFiles.length === 1) await fsp.rename(partFiles[0], whole);
    else {
      const out = fs.createWriteStream(whole);
      for (const pf of partFiles) { await pipeline(fs.createReadStream(pf), out, { end: false }); }
      out.end(); await new Promise((r) => out.on('finish', r));
      for (const pf of partFiles) await fsp.rm(pf, { force: true });
    }
    const h = await sha256File(whole);
    if (h !== a.sha256.toUpperCase()) { await fsp.rm(whole, { force: true }); throw new Error(`Checksum mismatch for ${a.name} — download corrupted, please retry`); }
    // install
    report({ phase: 'install', artifact: a.name, message: `Installing ${a.name}` });
    if (a.kind === 'zip') {
      if (a.replace_dir) await fsp.rm(path.join(dest, a.replace_dir), { recursive: true, force: true });
      await extractZip(whole, dest);
      await fsp.rm(whole, { force: true });
    } else {
      const target = path.join(dest, a.dest);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rm(target, { force: true });
      await fsp.rename(whole, target);
    }
    state.artifacts[a.name] = a.sha256;
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2));
  }
  state.version = m.version;
  state.installed_at = new Date().toISOString();
  state.gpu = nvidia ? 'nvidia' : 'other';
  await fsp.writeFile(stateFile, JSON.stringify(state, null, 2));
  await fsp.rm(tmp, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dest, 'yukti-server.exe'))) throw new Error('Installation incomplete: yukti-server.exe missing');
  report({ phase: 'done', pct: 100, message: `Yukti Server ${m.version} installed in ${dest}` });
  return { version: m.version, dest, gpu: state.gpu };
}

async function installedVersion(dest) {
  try { return JSON.parse(await fsp.readFile(path.join(dest, 'installed.json'), 'utf8')); } catch { return null; }
}

module.exports = { install, fetchManifest, installedVersion, hasNvidiaGpu, sha256File };
