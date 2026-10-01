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

// signal (optional): Pause stops the check of a large file at once (reading is safe to interrupt)
function sha256File(file, signal) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file, signal ? { signal } : {}).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex').toUpperCase()));
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 2 ** 20, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout));
  });
}

// PowerShell can hang (blocked by policy, very slow under memory pressure): never wait for it for ever
const PS_TIMEOUT_MS = 15000;

/** true / false, or null when the check itself failed - a caller that remembers the answer must not remember a failure. */
async function detectNvidiaGpu() {
  try {
    const out = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name -join ";"'], { timeout: PS_TIMEOUT_MS });
    return /nvidia/i.test(out);
  } catch { return null; }
}
async function hasNvidiaGpu() { return (await detectNvidiaGpu()) === true; }

async function freeBytes(dir) {
  try {
    const drive = path.parse(path.resolve(dir)).root.replace(/\\$/, '');
    const out = await run('powershell', ['-NoProfile', '-Command', `(Get-PSDrive -Name '${drive[0]}').Free`], { timeout: PS_TIMEOUT_MS });
    return Number(String(out).trim()) || null;
  } catch { return null; }
}

/**
 * Disk space an install needs: what is still to download, plus room to join/unpack it (the downloaded files and the
 * installed copy exist side by side for a moment). Bytes already downloaded are on the disk and are not needed again.
 */
function neededBytes(totalBytes, partialBytes = 0) {
  return Math.max(0, totalBytes - partialBytes) + Math.ceil((totalBytes * 11) / 10);
}

// When the app was built with the publisher's public key, the manifest must carry a valid Ed25519 signature
// (manifest.json.sig, made by ops/sign-manifest.js). The manifest pins the SHA-256 of every file, so a verified
// signature covers the whole download chain.
// A network that silently drops packets (firewall, captive portal) would otherwise leave the screen waiting for ever.
const MANIFEST_TIMEOUT_MS = 20000;
// fetchFn: the app passes Electron's net.fetch (uses the Windows proxy settings and certificate store, which plant
// networks need); the default is Node's own fetch so this file still runs without Electron (self-test).
async function fetchManifest(url, publicKey, timeoutMs = MANIFEST_TIMEOUT_MS, fetchFn = fetch) {
  // the time limit covers the answer AND its body, and does not depend on how a fetch implementation names its errors
  const once = async (u) => {
    const ctl = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    try {
      const r = await fetchFn(u, { cache: 'no-store', signal: ctl.signal });
      return { ok: r.ok, status: r.status, body: Buffer.from(await r.arrayBuffer()) };
    } catch (e) {
      if (timedOut) { const te = new Error('timed out'); te.name = 'TimeoutError'; throw te; }
      throw e;
    } finally { clearTimeout(t); }
  };
  // one quick second try: a server that closes the connection after each answer (HTTP/1.0 style, some proxies) makes the
  // signature request right after the manifest fail at random with "fetch failed" (reused, already closed connection)
  const get = (u) => once(u).catch((e) => (e && e.name === 'TimeoutError' ? Promise.reject(e) : once(u))).catch((e) => {
    throw new Error(e && e.name === 'TimeoutError' ? `fetch failed: no answer from ${u} within ${Math.round(timeoutMs / 1000)} s`
      : `fetch failed: ${e && e.message}${e && e.cause && e.cause.code ? ' (' + e.cause.code + ')' : ''}`);
  });
  const r = await get(url);
  if (!r.ok) throw new Error(`Cannot download manifest (${r.status}) from ${url}`);
  const raw = r.body;
  if (publicKey) {
    const sr = await get(url + '.sig');
    if (!sr.ok) throw new Error(`Release signature missing (${sr.status}) at ${url}.sig - refusing to install an unsigned release`);
    const sig = Buffer.from(sr.body.toString('utf8').trim(), 'base64');
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

// A connection that stays open but delivers nothing (Wi-Fi drop, sleeping proxy) would otherwise freeze the download for
// minutes: after this long without a single byte the part is given up and tried again (it resumes where it stopped).
const STALL_MS = 45000;

// Download one part with resume. Returns bytes written.
async function downloadPart(url, dest, expectedSize, onBytes, signal, fetchFn = fetch, stallMs = STALL_MS) {
  let have = 0;
  try { have = (await fsp.stat(dest)).size; } catch { /* new */ }
  if (have === expectedSize) return 0;
  if (have > expectedSize) { await fsp.rm(dest, { force: true }); have = 0; }
  const headers = have ? { Range: `bytes=${have}-` } : {};
  // own abort switch: stopped by Pause (the caller's signal) or by the "nothing arrives" watchdog
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let stalled = false, timer = null;
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctl.abort(); }, stallMs); };
  alive();
  try {
    const r = await fetchFn(url, { headers, signal: ctl.signal, cache: 'no-store' });
    alive();
    if (have && r.status === 200) { await fsp.rm(dest, { force: true }); have = 0; }       // server ignored Range → restart part
    else if (!r.ok && r.status !== 206) throw new Error(`Download failed (${r.status}) ${url}`);
    const out = fs.createWriteStream(dest, { flags: have ? 'a' : 'w' });
    // Count bytes inside the pipeline (a separate 'data' listener can race with pipeline and drop chunks).
    const counter = new Transform({ transform(chunk, _enc, cb) { alive(); onBytes(chunk.length); cb(null, chunk); } });
    await pipeline(Readable.fromWeb(r.body), counter, out);
  } catch (e) {
    if (stalled && !(signal && signal.aborted)) throw new Error(`Download stalled: nothing arrived from the network for ${Math.round(stallMs / 1000)} s (${url})`);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
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

/**
 * Add-ons as recorded on this computer (no internet needed): {feature: {on, present}}. present = it was added and every
 * file it brought is still there.
 */
function localFeatures(dest, state) {
  const out = {};
  const files = (state && state.featureFiles) || {};
  for (const f of new Set([...((state && state.features) || []), ...Object.keys(files)])) {
    const on = ((state && state.features) || []).includes(f);
    const list = files[f] || [];
    out[f] = { on, present: on && list.length > 0 && list.every((rel) => fs.existsSync(path.resolve(dest, rel))) };
  }
  return out;
}

// name of an artifact's complete (joined) file inside the .download folder
const wholeName = (a) => a.name + (a.kind === 'zip' ? '.zip' : '');

async function readState(dest) {
  try { return JSON.parse(await fsp.readFile(path.join(dest, 'installed.json'), 'utf8')); } catch { return { version: null, artifacts: {} }; }
}

/**
 * Work out what installing from a manifest means on this PC, without downloading anything.
 * @param {object} o {manifestUrl | manifest, dest, forceGpu, fetch (optional, see fetchManifest)}
 * @returns {Promise<{version, dest, nvidia, installed, artifacts:[{name,label,size,requires,needed,installed,partialBytes}],
 *           todoCount, wantedCount, totalBytes, partialBytes, freeBytes, needBytes}>}
 */
async function plan(o) {
  checkDest(o.dest);
  const m = o.manifest || await fetchManifest(o.manifestUrl, o.publicKey, MANIFEST_TIMEOUT_MS, o.fetch || fetch);
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
      // the parts were already joined into the complete file (an earlier run stopped while unpacking it)
      if (!partialBytes) {
        try { partialBytes = Math.min((await fsp.stat(path.join(tmp, wholeName(a)))).size, a.size); } catch { /* none */ }
      }
    }
    artifacts.push({ name: a.name, label: a.label || a.name, size: a.size, requires: a.requires || null, feature: a.feature || null,
      needed, installed, partialBytes });
  }
  // per add-on: what it costs on THIS computer (GPU-only parts are left out without an NVIDIA GPU)
  // installed: every part is there in THIS release's version; present: it was added and its files are still there (it
  // works), even if a newer version of it is waiting to be downloaded - such an add-on must never be offered as "Add"
  const featureInfo = {};
  const local = localFeatures(dest, state);
  for (const a of m.artifacts) {
    if (!a.feature || (a.requires === 'nvidia' && !nvidia)) continue;
    const f = featureInfo[a.feature] || (featureInfo[a.feature] = { size: 0, sizeTodo: 0, on: features.has(a.feature), installed: true,
      present: !!(local[a.feature] && local[a.feature].present) });
    f.size += a.size;
    if (!(state.artifacts[a.name] === a.sha256 && fs.existsSync(path.join(dest, a.check || a.dest)))) { f.installed = false; f.sizeTodo += a.size; }
  }
  for (const f of Object.values(featureInfo)) if (f.installed && f.on) f.present = true;
  const todo = artifacts.filter((a) => a.needed && !a.installed);
  const totalBytes = todo.reduce((s, a) => s + a.size, 0);
  const partialBytes = todo.reduce((s, a) => s + a.partialBytes, 0);
  let probe = dest;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  return {
    manifest: m, version: m.version, dest, nvidia, installed: state.version ? state : null, artifacts, features: featureInfo,
    todoCount: todo.length, wantedCount: artifacts.filter((a) => a.needed).length,
    totalBytes, partialBytes,
    freeBytes: await freeBytes(probe), needBytes: neededBytes(totalBytes, partialBytes),
  };
}

/**
 * Install or update the Yukti Server from a manifest.
 * @param {object} o {manifestUrl, publicKey (base64 SPKI; signature required when set), dest, onProgress(event), signal, forceGpu,
 *   fetch (optional: fetch implementation for every download, see fetchManifest), stallMs (optional, testing)}
 * Progress events: {phase:'manifest'|'plan'|'download'|'retry'|'verify'|'install'|'done', artifact, doneBytes, totalBytes, pct, message}
 * plus per-component {phase:'artifact', artifact, state:'waiting'|'downloading'|'verifying'|'installing'|'installed'|'skipped'|'paused'|'error'}.
 * 'download' events also carry artifactDone/artifactTotal, and partStart:true when a (possibly resumed) part begins.
 */
async function install(o) {
  const report = (x) => o.onProgress && o.onProgress(x);
  report({ phase: 'manifest', message: `Reading release manifest from ${o.manifestUrl}` });
  checkDest(o.dest);
  const fetchFn = o.fetch || fetch;
  // Pause: honoured while downloading and between the later steps where stopping is safe (never while files are replaced)
  const CANCELLED = 'Installation cancelled — run Install again to resume';
  const stopIfPaused = () => { if (o.signal && o.signal.aborted) throw new Error(CANCELLED); };
  const pausable = (p) => p.catch((e) => { stopIfPaused(); throw e; });
  const m = await fetchManifest(o.manifestUrl, o.publicKey, MANIFEST_TIMEOUT_MS, fetchFn);
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
  // what was downloaded earlier is already on the disk: only the rest (plus room to unpack) must still fit
  if (free !== null && free < pl.needBytes) throw new Error(`Not enough disk space on ${path.parse(dest).root}: need ~${(pl.needBytes / 2 ** 30).toFixed(1)} GB, have ${(free / 2 ** 30).toFixed(1)} GB`);

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
    const whole = path.join(tmp, wholeName(a));
    report({ phase: 'artifact', artifact: a.name, state: 'downloading' });
    try {
    // The complete file is still there from an earlier run (it was checked, but could not be put in place, e.g. because
    // a file was in use): check it again and use it instead of downloading everything once more.
    let reuse = false;
    const ws = await fsp.stat(whole).catch(() => null);
    if (ws) {
      if (ws.size === a.size) {
        report({ phase: 'verify', artifact: a.name, message: `Verifying ${a.name} (already downloaded)` });
        reuse = (await pausable(sha256File(whole, o.signal))) === a.sha256.toUpperCase();
      }
      if (reuse) { completed += a.size; artDone = a.size; current = 0; progress(a, true); }
      else await fsp.rm(whole, { force: true });   // incomplete or damaged leftover: the parts are used (or downloaded again)
    }
    for (let i = 0; !reuse && i < a.parts.length; i++) {
      const p = a.parts[i];
      const pf = path.join(tmp, `${a.name}.part${i}`);
      partFiles.push(pf);
      let tries = 0;
      for (;;) {
        try {
          current = Math.min((await fsp.stat(pf).catch(() => ({ size: 0 }))).size, p.size);
          progress(a, true, true);
          await downloadPart(resolveUrl(o.manifestUrl, p.url), pf, p.size, (n) => { current += n; progress(a); }, o.signal, fetchFn, o.stallMs);
          const h = await sha256File(pf, o.signal);
          if (h !== p.sha256.toUpperCase()) { await fsp.rm(pf, { force: true }); throw new Error(`Checksum mismatch in ${a.name} part ${i + 1}`); }
          completed += p.size; artDone += p.size; current = 0; progress(a, true);
          break;
        } catch (e) {
          stopIfPaused();
          if (++tries >= 3) throw e;
          report({ phase: 'retry', artifact: a.name, message: `${e.message} — retrying (${tries}/3)` });
          await new Promise((r) => setTimeout(r, 2000 * tries));
        }
      }
    }
    // join parts → verify whole artifact
    report({ phase: 'artifact', artifact: a.name, state: 'verifying' });
    report({ phase: 'verify', artifact: a.name, message: `Verifying ${a.name}` });
    if (!reuse) {
      stopIfPaused();
      if (partFiles.length === 1) await fsp.rename(partFiles[0], whole);
      else {
        // paused while joining: the parts are all still there (they are deleted only after the join), so nothing is lost
        const out = fs.createWriteStream(whole);
        try {
          for (const pf of partFiles) { await pipeline(fs.createReadStream(pf), out, { end: false, ...(o.signal ? { signal: o.signal } : {}) }); }
          out.end();
          await new Promise((res, rej) => { out.once('finish', res); out.once('error', rej); });
        } catch (e) { out.destroy(); stopIfPaused(); throw e; }
        for (const pf of partFiles) await fsp.rm(pf, { force: true });
      }
      const h = await pausable(sha256File(whole, o.signal));
      if (h !== a.sha256.toUpperCase()) { await fsp.rm(whole, { force: true }); throw new Error(`Checksum mismatch for ${a.name} — download corrupted, please retry`); }
    }
    stopIfPaused();   // last safe moment: the checked file stays in .download and is used as it is next time
    // install
    report({ phase: 'artifact', artifact: a.name, state: 'installing' });
    report({ phase: 'install', artifact: a.name, message: `Installing ${a.name}` });
    if (a.kind === 'zip') {
      // retried for a few seconds: right after Yukti was stopped, Windows may still hold some of these files
      if (a.replace_dir) await fsp.rm(path.join(dest, a.replace_dir), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
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

async function localFeaturesAt(dest) { return localFeatures(path.resolve(dest), await readState(path.resolve(dest))); }

module.exports = { install, plan, removeFeature, fetchManifest, installedVersion, localFeatures: localFeaturesAt, hasNvidiaGpu, detectNvidiaGpu,
  freeBytes, neededBytes, sha256File };
