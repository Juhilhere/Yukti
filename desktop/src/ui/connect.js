'use strict';
// Setup + install page (runs inside the main Yukti window, file:// only).
const $ = (id) => document.getElementById(id);
const Y = window.yukti;
let mode = 'install';
let installing = false;
let cfg = null;
let planRes = null;          // result of yukti.plan()
let planSeq = 0;
const rows = new Map();      // artifact name → { li, st, mini, size, state }

// ---------------------------------------------------------------- helpers
const fmtBytes = (b) => {
  if (b == null) return '';
  if (b >= 2 ** 30) return (b / 2 ** 30).toFixed(2) + ' GB';
  if (b >= 2 ** 20) return (b / 2 ** 20).toFixed(0) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
};
const fmtEta = (s) => {
  if (!isFinite(s) || s < 0) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))} s left`;
  if (s < 3600) return `${Math.round(s / 60)} min left`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`;
};
function msg(el, text, kind) { el.textContent = text || ''; el.className = 'msg ' + (kind || ''); }
function show(el, on) { el.classList.toggle('hidden', !on); }

// ---------------------------------------------------------------- option selection
function primaryLabel() {
  if (mode === 'remote') return 'Connect';
  if (mode === 'local') return 'Start Yukti';
  const p = planRes && planRes.plan;
  const inst = planRes && planRes.installed && planRes.installed.version;
  if (p && p.todoCount === 0 && inst) return 'Start Yukti';
  if (p && inst) return p.partialBytes ? 'Resume update' : 'Update & start';
  if (p && p.partialBytes) return `Resume install (${fmtBytes(p.totalBytes - p.partialBytes)} left)`;
  if (p) return `Install (${fmtBytes(p.totalBytes)})`;
  if (inst) return 'Start Yukti';
  return 'Install';
}
function select(m) {
  if (installing) return;
  mode = m;
  for (const k of ['install', 'remote', 'local']) {
    $('r-' + k).checked = m === k;
    $('opt-' + k).classList.toggle('sel', m === k);
  }
  refreshGo();
}
function refreshGo() {
  $('go').textContent = primaryLabel();
  const p = planRes && planRes.plan;
  const lowDisk = mode === 'install' && p && p.freeBytes != null && p.totalBytes > 0 && p.freeBytes < p.needBytes;
  $('go').disabled = installing || !!lowDisk;
}

document.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => select(o.dataset.mode)));

// ---------------------------------------------------------------- plan / checklist
function stateText(r) {
  switch (r.state) {
    case 'installed': return 'installed';
    case 'skipped': return 'skipped — not needed on this PC';
    case 'downloading': return `downloading ${r.pct || 0}%`;
    case 'verifying': return 'verifying…';
    case 'installing': return 'installing…';
    case 'paused': return `paused at ${r.pct || 0}%`;
    case 'error': return 'failed';
    default: return r.partial ? `waiting — ${Math.floor((100 * r.partial) / r.size)}% already downloaded` : 'waiting';
  }
}
function setRow(name, patch) {
  const r = rows.get(name);
  if (!r) return;
  Object.assign(r, patch);
  r.li.className = r.state;
  r.st.textContent = stateText(r);
  r.mini.style.width = (r.pct || 0) + '%';
}
function renderChecklist(p) {
  const ul = $('checklist');
  ul.textContent = '';
  rows.clear();
  if (!p) { show(ul, false); return; }
  show(ul, true);
  for (const a of p.artifacts) {
    const li = document.createElement('li');
    const ico = document.createElement('span'); ico.className = 'ico';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = a.label || a.name;
    name.title = a.name;
    const size = document.createElement('small'); size.textContent = fmtBytes(a.size); name.appendChild(size);
    const st = document.createElement('span'); st.className = 'st';
    const mini = document.createElement('div'); mini.className = 'mini'; const fill = document.createElement('div'); mini.appendChild(fill);
    li.append(ico, name, st, mini);
    ul.appendChild(li);
    rows.set(a.name, { li, st, mini: fill, size: a.size, partial: a.partialBytes,
      pct: a.partialBytes ? Math.floor((100 * a.partialBytes) / a.size) : 0,
      state: !a.needed ? 'skipped' : a.installed ? 'installed' : 'waiting' });
    setRow(a.name, {});
  }
}
function renderPlan() {
  const r = planRes;
  const p = r && r.plan;
  const inst = r && r.installed && r.installed.version ? r.installed : null;
  const tag = $('inst-tag');
  if (inst) { tag.textContent = `installed ${inst.version}`; show(tag, true); } else show(tag, false);
  renderChecklist(p);
  let s = '';
  if (p) {
    if (p.todoCount === 0) s = `Yukti Server ${p.version} is installed and up to date in ${p.dest}.`;
    else {
      s = `${inst ? `Update ${inst.version} → ${p.version}` : `Yukti Server ${p.version}`}: ${p.todoCount} of ${p.wantedCount} components, ${fmtBytes(p.totalBytes)} to download`;
      if (p.partialBytes) s += ` (${fmtBytes(p.partialBytes)} already downloaded — resumes)`;
      s += p.nvidia ? ' · NVIDIA GPU detected' : ' · no NVIDIA GPU (Vulkan/CPU runtime)';
    }
  } else if (r && r.error) {
    s = '';
  } else if (inst) {
    s = `Installed: Yukti Server ${inst.version} in ${r.dest}`;
  }
  $('plan-summary').textContent = s;
  const warn = $('disk-warn');
  if (p && p.freeBytes != null && p.totalBytes > 0 && p.freeBytes < p.needBytes) {
    warn.textContent = `Not enough free disk space on this drive: about ${fmtBytes(p.needBytes)} is needed during installation, only ${fmtBytes(p.freeBytes)} is free. Free some space or choose another install folder.`;
    show(warn, true);
  } else if (p && p.freeBytes != null && p.totalBytes > 0 && p.freeBytes < p.needBytes * 1.5) {
    warn.textContent = `Disk space is tight: ${fmtBytes(p.freeBytes)} free, about ${fmtBytes(p.needBytes)} needed during installation.`;
    show(warn, true);
  } else show(warn, false);
  if (r && r.error) msg($('inst-msg'), `Download source not reachable (${r.error}). You can still connect to a plant server.`, 'warn');
  else if (r && !p && !$('manifest').value.trim()) msg($('inst-msg'), inst ? '' : 'No download source configured. Enter the manifest URL from your organisation\'s Yukti page under “Download source”.', inst ? '' : 'warn');
  else msg($('inst-msg'), '');
  if (r && !p && !$('manifest').value.trim()) $('src-det').open = true;
  refreshGo();
}
async function loadPlan() {
  if (installing) return;
  const seq = ++planSeq;
  msg($('inst-msg'), 'Checking this PC and the download source…');
  $('go').disabled = true;
  const r = await Y.plan({ manifestUrl: $('manifest').value, dest: $('dest').value });
  if (seq !== planSeq || installing) return;
  planRes = r;
  renderPlan();
}
let planTimer = null;
const replanSoon = () => { clearTimeout(planTimer); planTimer = setTimeout(loadPlan, 600); };
$('dest').addEventListener('input', replanSoon);
$('manifest').addEventListener('input', replanSoon);

// ---------------------------------------------------------------- install progress
let speed = 0, last = null;
function resetSpeed() { speed = 0; last = null; }
Y.onInstallProgress((p) => {
  if (p.phase === 'artifact') {
    const r = rows.get(p.artifact);
    const patch = { state: p.state };
    if (p.state === 'installed') patch.pct = 100;
    if (r && p.state === 'downloading' && !r.pct) patch.pct = 0;
    setRow(p.artifact, patch);
    return;
  }
  if (p.phase === 'download') {
    const now = performance.now();
    if (p.partStart || !last) last = { t: now, b: p.doneBytes };
    else {
      const dt = (now - last.t) / 1000;
      if (dt >= 0.5) {
        const inst = Math.max(0, (p.doneBytes - last.b) / dt);
        speed = speed ? 0.75 * speed + 0.25 * inst : inst;
        last = { t: now, b: p.doneBytes };
      }
    }
    $('bar').classList.remove('indet');
    $('bar-fill').style.width = p.pct + '%';
    $('p-left').textContent = `${fmtBytes(p.doneBytes)} of ${fmtBytes(p.totalBytes)} · ${p.pct}%`;
    $('p-right').textContent = speed > 0 ? `${(speed / 2 ** 20).toFixed(1)} MB/s · ${fmtEta((p.totalBytes - p.doneBytes) / speed)}` : 'measuring speed…';
    if (p.artifactTotal) setRow(p.artifact, { state: 'downloading', pct: Math.min(100, Math.floor((100 * p.artifactDone) / p.artifactTotal)) });
    return;
  }
  if (p.phase === 'verify' || p.phase === 'install') {
    $('p-right').textContent = p.phase === 'verify' ? 'verifying checksums…' : 'unpacking…';
  }
  if (p.phase === 'done') { $('bar-fill').style.width = '100%'; $('p-right').textContent = 'done'; }
  if (p.message) msg($('inst-msg'), p.message, p.phase === 'retry' ? 'warn' : '');
});

function setInstalling(on) {
  installing = on;
  document.querySelectorAll('.opt:not(#opt-install)').forEach((o) => o.classList.toggle('locked', on));
  ['dest', 'manifest', 'browse-dest'].forEach((id) => { $(id).disabled = on; });
  show($('pause'), on);
  $('pause').disabled = false;
  show($('back'), !on && !!(cfg && cfg.canGoBack));
  refreshGo();
}

async function runInstall() {
  show($('inst-err'), false);
  msg($('go-msg'), '');
  resetSpeed();
  show($('progress'), true);
  $('bar').classList.add('indet');
  $('p-left').textContent = 'Preparing…'; $('p-right').textContent = '';
  setInstalling(true);
  $('go').textContent = 'Installing…';
  const r = await Y.install({ manifestUrl: $('manifest').value, dest: $('dest').value });
  if (r.ok) {
    msg($('inst-msg'), `Yukti Server ${r.version} installed. Starting Yukti…`, 'ok');
    $('go').textContent = 'Starting…';
    return;   // the main process switches this window to the startup page
  }
  setInstalling(false);
  $('bar').classList.remove('indet');
  if (r.cancelled) {
    msg($('inst-msg'), 'Paused. Downloaded data is kept — Resume continues where it stopped.', 'warn');
    for (const [n, row] of rows) if (row.state === 'downloading') setRow(n, { state: 'paused' });
    $('p-right').textContent = 'paused';
    $('go').textContent = 'Resume';
  } else {
    msg($('inst-msg'), '');
    $('inst-err-text').textContent = r.error;
    show($('inst-err'), true);
    $('go').textContent = 'Retry';
  }
}

$('pause').addEventListener('click', () => { $('pause').disabled = true; $('pause').textContent = 'Pausing…'; Y.cancelInstall().then(() => { $('pause').textContent = 'Pause'; }); });
$('retry').addEventListener('click', (e) => { e.stopPropagation(); runInstall(); });
$('inst-logs').addEventListener('click', (e) => { e.stopPropagation(); Y.openLogs('desktop'); });

// ---------------------------------------------------------------- other options
$('test').addEventListener('click', async (e) => {
  e.stopPropagation(); select('remote');
  $('test').disabled = true; msg($('test-msg'), 'Testing…');
  const r = await Y.test($('url').value);
  $('test').disabled = false;
  if (r.ok) msg($('test-msg'), `Connected: Yukti v${r.version} at ${r.base} — engine: ${r.engine}`, 'ok');
  else msg($('test-msg'), `Failed: ${r.error}`, 'err');
});
$('browse').addEventListener('click', async (e) => { e.stopPropagation(); select('local'); const p = await Y.browseRoot(); if (p) $('root').value = p; });
$('browse-dest').addEventListener('click', async (e) => { e.stopPropagation(); select('install'); const p = await Y.browseRoot(); if (p) { $('dest').value = p; loadPlan(); } });
$('back').addEventListener('click', () => Y.back());

$('go').addEventListener('click', async () => {
  if (installing) return;
  if (mode === 'install') {
    const p = planRes && planRes.plan;
    const inst = planRes && planRes.installed && planRes.installed.version;
    if (inst && (!p || p.todoCount === 0)) {   // nothing to download → just start it
      $('go').disabled = true; msg($('go-msg'), 'Starting…');
      const r = await Y.connect({ mode: 'local', installRoot: $('dest').value });
      if (!r.ok) { $('go').disabled = false; msg($('go-msg'), r.error, 'err'); }
      return;
    }
    return runInstall();
  }
  $('go').disabled = true;
  msg($('go-msg'), mode === 'local' ? 'Starting…' : 'Connecting…');
  const r = await Y.connect({ mode, serverUrl: $('url').value, installRoot: $('root').value });
  if (!r.ok) { $('go').disabled = false; msg($('go-msg'), r.error, 'err'); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !installing && !$('go').disabled && e.target.tagName !== 'BUTTON') $('go').click();
});

// ---------------------------------------------------------------- init
(async () => {
  cfg = await Y.getConfig();
  $('ver').textContent = 'v' + cfg.version;
  $('url').value = cfg.mode === 'remote' ? cfg.serverUrl : '';
  $('root').value = cfg.installRoot || '';
  $('dest').value = cfg.dest;
  $('manifest').value = cfg.manifestUrl || '';
  show($('back'), !!cfg.canGoBack);
  if (cfg.notice) { $('notice').textContent = cfg.notice; show($('notice'), true); }
  select(cfg.defaultMode || 'remote');
  await loadPlan();
  document.body.dataset.ready = '1';
})();
