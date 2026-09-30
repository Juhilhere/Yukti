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

// When the app was built with the publisher's public key, the manifest must carry a valid Ed25519 signature
// (manifest.json.sig, made by ops/sign-manifest.js). The manifest pins the SHA-256 of every file, so a verified
// signature covers the whole download chain.
async function fetchManifest(url, publicKey) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Cannot download manifest (${r.status}) from ${url}`);
  const raw = Buffer.from(await r.arrayBuffer());
  if (publicKey) {
    const sr = await fetch(url + '.sig', { cache: 'no-store' });
    if (!sr.ok) throw new Error(`Release signature missing (${sr.status}) at ${url}.sig - refusing to install an unsigned release`);
    const sig = Buffer.from((await sr.text()).trim(), 'base64');
    let ok = false;
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
      ok = crypto.verify(null, raw, key, sig);
    } catch { ok = false; }
    if (!ok) throw new Error('Release signature is invalid - this download source is not signed by the Yukti publisher. Nothing was installed.');
  }
  let m;
  try { m = JSON.parse(raw.toString('utf8')); } catch { throw new Error('Not a Yukti release manifest'); }
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

function checkDest(dest) {
  // Require a full absolute path (e.g. C:\Yukti\Server); reject drive-relative ("E:folder") or relative paths.
  if (!/^[A-Za-z]:[\\/]/.test(String(dest || '')) && !String(dest || '').startsWith('\\\\')) {
    throw new Error(`Install folder must be a full path such as C:\\Yukti\\Server (got "${dest}")`);
  }
}

async function readState(dest) {
  try { return JSON.parse(await fsp.readFile(path.join(dest, 'installed.json'), 'utf8')); } catch { return { version: null, artifacts: {} }; }
}

/**
 * Work out what installing from a manifest means on this PC, without downloading anything.
 * @param {object} o {manifestUrl | manifest, dest, forceGpu}
 * @returns {Promise<{version, dest, nvidia, installed, artifacts:[{name,label,size,requires,needed,installed,partialBytes}],
 *           todoCount, wantedCount, totalBytes, partialBytes, freeBytes, needBytes}>}
 */
async function plan(o) {
  checkDest(o.dest);
  const m = o.manifest || await fetchManifest(o.manifestUrl, o.publicKey);
  const dest = path.resolve(o.dest);
  const tmp = path.join(dest, '.download');
  const nvidia = o.forceGpu !== undefined ? o.forceGpu : await hasNvidiaGpu();
  const state = await readState(dest);
  state.artifacts = state.artifacts || {};
  // optional add-ons (photos, voice) are downloaded only when switched on; the ones already on stay on across updates
  const features = new Set(o.features || state.features || []);
  const artifacts = [];
  for (const a of m.artifacts) {
    const needed = !(a.requires === 'nvidia' && !nvidia) && (!a.feature || features.has(a.feature));
    const installed = needed && state.artifacts[a.name] === a.sha256 && fs.existsSync(path.join(dest, a.check || a.dest));
    let partialBytes = 0;
    if (needed && !installed) {
      for (let i = 0; i < (a.parts || []).length; i++) {
        try { partialBytes += Math.min((await fsp.stat(path.join(tmp, `${a.name}.part${i}`))).size, a.parts[i].size); } catch { /* none */ }
      }
    }
    artifacts.push({ name: a.name, label: a.label || a.name, size: a.size, requires: a.requires || null, feature: a.feature || null,
      needed, installed, partialBytes });
  }
  // per add-on: what it costs on THIS computer (GPU-only parts are left out without an NVIDIA GPU)
  const featureInfo = {};
  for (const a of m.artifacts) {
    if (!a.feature || (a.requires === 'nvidia' && !nvidia)) continue;
    const f = featureInfo[a.feature] || (featureInfo[a.feature] = { size: 0, on: features.has(a.feature), installed: true });
    f.size += a.size;
    if (!(state.artifacts[a.name] === a.sha256 && fs.existsSync(path.join(dest, a.check || a.dest)))) f.installed = false;
  }
  const todo = artifacts.filter((a) => a.needed && !a.installed);
  const totalBytes = todo.reduce((s, a) => s + a.size, 0);
  let probe = dest;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  return {
    manifest: m, version: m.version, dest, nvidia, installed: state.version ? state : null, artifacts, features: featureInfo,
    todoCount: todo.length, wantedCount: artifacts.filter((a) => a.needed).length,
    totalBytes, partialBytes: todo.reduce((s, a) => s + a.partialBytes, 0),
    freeBytes: await freeBytes(probe), needBytes: Math.ceil(totalBytes * 2.1),
  };
}

/**
 * Install or update the Yukti Server from a manifest.
 * @param {object} o {manifestUrl, publicKey (base64 SPKI; signature required when set), dest, onProgress(event), signal, forceGpu}
 * Progress events: {phase:'manifest'|'plan'|'download'|'retry'|'verify'|'install'|'done', artifact, doneBytes, totalBytes, pct, message}
 * plus per-component {phase:'artifact', artifact, state:'waiting'|'downloading'|'verifying'|'installing'|'installed'|'skipped'|'paused'|'error'}.
 * 'download' events also carry artifactDone/artifactTotal, and partStart:true when a (possibly resumed) part begins.
 */
async function install(o) {
  const report = (x) => o.onProgress && o.onProgress(x);
  report({ phase: 'manifest', message: `Reading release manifest from ${o.manifestUrl}` });
  checkDest(o.dest);
  const m = await fetchManifest(o.manifestUrl, o.publicKey);
  const dest = path.resolve(o.dest);
  const tmp = path.join(dest, '.download');
  await fsp.mkdir(tmp, { recursive: true });
  const pl = await plan({ manifest: m, dest, forceGpu: o.forceGpu, features: o.features });
  const nvidia = pl.nvidia;
  const stateFile = path.join(dest, 'installed.json');
  const state = await readState(dest);
  state.artifacts = state.artifacts || {};

  const todoNames = new Set(pl.artifacts.filter((a) => a.needed && !a.installed).map((a) => a.name));
  for (const a of pl.artifacts) report({ phase: 'artifact', artifact: a.name, state: !a.needed ? 'skipped' : a.installed ? 'installed' : 'waiting' });
  const wantedNames = new Set(pl.artifacts.filter((a) => a.needed).map((a) => a.name));
  const wanted = m.artifacts.filter((a) => wantedNames.has(a.name));
  const todo = m.artifacts.filter((a) => todoNames.has(a.name));
  const total = pl.totalBytes;
  report({ phase: 'plan', dest, message: `Yukti ${m.version} → ${dest}: ${todo.length} of ${wanted.length} components to download (${(total / 2 ** 30).toFixed(2)} GB)` +
    (nvidia ? ' · NVIDIA GPU detected (CUDA build)' : ' · no NVIDIA GPU (Vulkan/CPU build)'), totalBytes: total });
  const free = pl.freeBytes;
  if (free !== null && free < total * 2.1) throw new Error(`Not enough disk space on ${path.parse(dest).root}: need ~${(total * 2.1 / 2 ** 30).toFixed(1)} GB, have ${(free / 2 ** 30).toFixed(1)} GB`);

  let completed = 0;   // bytes of verified parts
  let current = 0;     // bytes of the part being downloaded (incl. resumed bytes)
  let lastReport = 0;
  let artDone = 0;     // verified bytes of the current artifact
  const progress = (a, force, partStart) => {
    const now = Date.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    const d = completed + current;
    report({ phase: 'download', artifact: a.name, doneBytes: d, totalBytes: total, pct: total ? Math.min(100, Math.round(100 * d / total)) : 100,
      artifactDone: artDone + current, artifactTotal: a.size, ...(partStart ? { partStart: true } : {}) });
  };
  for (const a of todo) {
    const partFiles = [];
    artDone = 0;
    report({ phase: 'artifact', artifact: a.name, state: 'downloading' });
    try {
    for (let i = 0; i < a.parts.length; i++) {
      const p = a.parts[i];
      const pf = path.join(tmp, `${a.name}.part${i}`);
      partFiles.push(pf);
      let tries = 0;
      for (;;) {
        try {
          current = Math.min((await fsp.stat(pf).catch(() => ({ size: 0 }))).size, p.size);
          progress(a, true, true);
          await downloadPart(resolveUrl(o.manifestUrl, p.url), pf, p.size, (n) => { current += n; progress(a); }, o.signal);
          const h = await sha256File(pf);
          if (h !== p.sha256.toUpperCase()) { await fsp.rm(pf, { force: true }); throw new Error(`Checksum mismatch in ${a.name} part ${i + 1}`); }
          completed += p.size; artDone += p.size; current = 0; progress(a, true);
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
    report({ phase: 'artifact', artifact: a.name, state: 'verifying' });
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
    report({ phase: 'artifact', artifact: a.name, state: 'installing' });
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
    if (a.feature) {   // remember which files belong to an add-on, so it can be removed again
      state.featureArtifacts = { ...(state.featureArtifacts || {}), [a.name]: a.feature };
      state.featureFiles = state.featureFiles || {};
      const list = new Set(state.featureFiles[a.feature] || []);
      list.add(a.kind === 'zip' ? (a.replace_dir || a.check) : a.dest);
      state.featureFiles[a.feature] = [...list];
    }
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2));
    } catch (e) {
      report({ phase: 'artifact', artifact: a.name, state: (o.signal && o.signal.aborted) ? 'paused' : 'error', message: e.message });
      throw e;
    }
    report({ phase: 'artifact', artifact: a.name, state: 'installed' });
  }
  state.version = m.version;
  state.features = [...new Set(pl.artifacts.filter((a) => a.feature && a.needed).map((a) => a.feature))];
  state.installed_at = new Date().toISOString();
  state.gpu = nvidia ? 'nvidia' : 'other';
  await fsp.writeFile(stateFile, JSON.stringify(state, null, 2));
  await fsp.rm(tmp, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dest, 'yukti-server.exe'))) throw new Error('Installation incomplete: yukti-server.exe missing');
  report({ phase: 'done', pct: 100, message: `Yukti Server ${m.version} installed in ${dest}` });
  return { version: m.version, dest, gpu: state.gpu };
}

/** Switch an add-on off: delete its files (the server must be stopped) and forget it. */
async function removeFeature(dest, feature) {
  checkDest(dest);
  dest = path.resolve(dest);
  const stateFile = path.join(dest, 'installed.json');
  const state = await readState(dest);
  for (const rel of (state.featureFiles || {})[feature] || []) {
    const target = path.resolve(dest, rel);
    if (!target.startsWith(dest + path.sep)) continue;   // never outside the install folder
    await fsp.rm(target, { recursive: true, force: true });
  }
  state.features = (state.features || []).filter((f) => f !== feature);
  if (state.featureFiles) delete state.featureFiles[feature];
  // forget the component hashes so switching the add-on on again downloads it again
  for (const name of Object.keys(state.artifacts || {})) {
    if ((state.featureArtifacts || {})[name] === feature) delete state.artifacts[name];
  }
  await fsp.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function installedVersion(dest) {
  try { return JSON.parse(await fsp.readFile(path.join(dest, 'installed.json'), 'utf8')); } catch { return null; }
}

module.exports = { install, plan, removeFeature, fetchManifest, installedVersion, hasNvidiaGpu, freeBytes, sha256File };
