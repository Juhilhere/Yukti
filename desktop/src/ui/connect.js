'use strict';
// Setup page (file:// only). Simple view by default: checks, downloads and installs Yukti by itself with plain-language
// progress and errors. The advanced view (IT staff) keeps every option: install folder, download source, plant server,
// existing server folder.
const $ = (id) => document.getElementById(id);
const Y = window.yukti;
let lang = 'en';
let cfg = null;
let view = 'simple';
let mode = 'install';
let installing = false;
let planRes = null;
let planSeq = 0;
let retryTimer = null;
let intro = ['setup.introChecking', null];   // current intro sentence (key, vars) — re-rendered when the language changes
const renderIntro = () => { $('s-intro').textContent = T(intro[0], intro[1]); };
const rows = new Map();          // artifact → row (simple and advanced lists share state)

// ---------------------------------------------------------------- text
const T = (k, v) => window.YI.t(lang, k, v);
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  const box = $('langs');
  box.textContent = '';
  for (const l of window.YI.LANGS) {
    const b = document.createElement('button');
    b.className = 'ghost small' + (l === lang ? ' on' : '');
    b.textContent = window.YI.t(l, 'lang.name');
    b.addEventListener('click', async () => { lang = l; await Y.setLang(l); applyI18n(); renderPlan(); });
    box.appendChild(b);
  }
  if (cfg && cfg.bundled) { $('local-title').textContent = T('adv.local.titleBundled'); $('local-desc').textContent = T('adv.local.descBundled'); }
  renderIntro();
  if (installing) for (const b of ['pause', 's-pause']) if (!$(b).disabled) $(b).textContent = T('setup.pause');
}
const fmtBytes = (b) => {
  if (b == null) return '';
  if (b >= 2 ** 30) return (b / 2 ** 30).toFixed(1) + ' GB';
  if (b >= 2 ** 20) return (b / 2 ** 20).toFixed(0) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
};
const fmtEta = (s) => {
  if (!isFinite(s) || s < 0) return '';
  if (s < 60) return T('setup.eta.s');
  if (s < 3600) return T('setup.eta.m', { n: Math.round(s / 60) });
  return T('setup.eta.h', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) });
};
function msg(el, text, kind) { el.textContent = text || ''; el.className = 'msg ' + (kind || ''); }
function show(el, on) { el.classList.toggle('hidden', !on); }
const friendlyName = (a) => a.name === 'server-core' ? T('setup.step.app') : a.name === 'llama-cuda' ? T('setup.step.engineGpu')
  : a.name === 'llama-vulkan' ? T('setup.step.engine') : a.name.startsWith('model') ? T('setup.step.model')
  : a.name.startsWith('speech') ? T('setup.step.voice') : a.name.startsWith('voice') ? T('setup.step.voiceModel') : (a.label || a.name);

/** Installer / network errors → plain words (+ whether to retry automatically). */
function classify(raw) {
  const e = String(raw || '');
  if (/signature/i.test(e)) return { text: T('setup.err.signature'), auto: false };
  if (/checksum/i.test(e)) return { text: T('setup.err.damaged'), auto: false };
  if (/ENOSPC|no space|disk full/i.test(e)) {
    const p = planRes && planRes.plan;
    return { text: T('setup.err.disk', { need: fmtBytes(p && p.needBytes), free: fmtBytes(p && p.freeBytes) }), auto: false };
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket|terminated|UND_ERR/i.test(e)) return { text: T('setup.err.network'), auto: true };
  if (/\((4\d\d|5\d\d)\)/.test(e)) return { text: T('setup.err.server'), auto: /\(5\d\d\)/.test(e) };
  return { text: T('setup.err.other', { msg: e }), auto: false };
}

// ---------------------------------------------------------------- views
function setView(v) {
  view = v;
  show($('simple'), v === 'simple');
  show($('advanced'), v === 'advanced');
  renderPlan();
}
$('s-more').addEventListener('click', () => { if (!installing) setView('advanced'); });
$('a-less').addEventListener('click', () => { if (!installing) setView('simple'); });

// ---------------------------------------------------------------- checklist (both views)
function stateText(r) {
  switch (r.state) {
    case 'installed': return T('setup.state.installed');
    case 'skipped': return T('setup.state.skipped');
    case 'optional': return T('setup.state.optional');
    case 'downloading': return T('setup.state.downloading', { pct: r.pct || 0 });
    case 'verifying': return T('setup.state.verifying');
    case 'installing': return T('setup.state.installing');
    case 'paused': return T('setup.state.paused', { pct: r.pct || 0 });
    case 'error': return T('setup.state.error');
    default: return r.partial ? T('setup.state.partial', { pct: Math.floor((100 * r.partial) / r.size) }) : T('setup.state.waiting');
  }
}
function paintRow(r) {
  for (const v of r.views) {
    v.li.className = r.state;
    v.st.textContent = stateText(r);
    v.mini.style.width = (r.pct || 0) + '%';
  }
}
function setRow(name, patch) { const r = rows.get(name); if (r) { Object.assign(r, patch); paintRow(r); } }
function buildRow(ul, a, simple) {
  const li = document.createElement('li');
  const ico = document.createElement('span'); ico.className = 'ico';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = simple ? friendlyName(a) : (a.label || a.name);
  name.title = a.name;
  const size = document.createElement('small'); size.textContent = fmtBytes(a.size); name.appendChild(size);
  const st = document.createElement('span'); st.className = 'st';
  const mini = document.createElement('div'); mini.className = 'mini'; const fill = document.createElement('div'); mini.appendChild(fill);
  li.append(ico, name, st, mini);
  ul.appendChild(li);
  return { li, st, mini: fill };
}
function renderChecklists(p) {
  const keep = new Map(rows);
  rows.clear();
  for (const id of ['s-checklist', 'checklist']) { $(id).textContent = ''; show($(id), !!p); }
  if (!p) return;
  for (const a of p.artifacts) {
    const old = keep.get(a.name);
    const r = {
      size: a.size, partial: a.partialBytes, views: [],
      pct: old && installing ? old.pct : a.partialBytes ? Math.floor((100 * a.partialBytes) / a.size) : 0,
      state: old && installing ? old.state : !a.needed ? (a.feature ? 'optional' : 'skipped') : a.installed ? 'installed' : 'waiting',
    };
    if (a.needed) r.views.push(buildRow($('s-checklist'), a, true));   // normal users only see what their PC needs
    show($('s-later-hint'), p.artifacts.some((x) => x.feature && !x.needed));
    r.views.push(buildRow($('checklist'), a, false));
    rows.set(a.name, r);
    paintRow(r);
  }
}

// ---------------------------------------------------------------- plan
function primaryLabel() {
  if (view === 'advanced') {
    if (mode === 'remote') return T('adv.connect');
    if (mode === 'local') return T('adv.startYukti');
  }
  const p = planRes && planRes.plan;
  const inst = planRes && planRes.installed && planRes.installed.version;
  if (p && p.todoCount === 0 && inst) return view === 'simple' ? T('setup.openYukti') : T('adv.startYukti');
  if (p && inst) return view === 'simple' ? T('setup.update.now') : T('adv.update');
  if (p && p.partialBytes) return view === 'simple' ? T('setup.resume') : T('adv.resumeInstall', { size: fmtBytes(p.totalBytes - p.partialBytes) });
  if (p) return view === 'simple' ? T('setup.start') : T('adv.install', { size: fmtBytes(p.totalBytes) });
  return view === 'simple' ? T('setup.tryAgain') : T('adv.continue');
}
function lowDisk(p) { return !!(p && p.freeBytes != null && p.totalBytes > 0 && p.freeBytes < p.needBytes); }
function refreshGo() {
  const p = planRes && planRes.plan;
  $('go').textContent = primaryLabel();
  $('go').disabled = installing || (mode === 'install' && lowDisk(p));
  $('s-go').textContent = primaryLabel();
  $('s-go').disabled = installing;
  show($('s-go'), !installing);
  // an update is offered: "Later" opens the installed version
  const inst = planRes && planRes.installed && planRes.installed.version;
  show($('s-later'), !installing && view === 'simple' && !!(p && inst && p.todoCount > 0));
}
function renderPlan() {
  const r = planRes;
  const p = r && r.plan;
  const inst = r && r.installed && r.installed.version ? r.installed : null;
  renderChecklists(p);
  // simple view text
  if (!installing) {
    if (p && p.todoCount === 0 && inst) intro = ['setup.upToDate', null];
    else if (p && inst) intro = ['setup.update.body', { v: p.version, size: fmtBytes(p.totalBytes) }];
    else if (p) intro = ['setup.intro', { size: fmtBytes(p.totalBytes) }];
    else if (r && !(cfg && cfg.manifestUrl) && !$('manifest').value.trim()) intro = ['setup.noSource', null];
    else intro = ['setup.introChecking', null];
  }
  renderIntro();
  const disk = lowDisk(p);
  const sd = $('s-disk');
  if (disk) { sd.textContent = T('setup.err.disk', { need: fmtBytes(p.needBytes), free: fmtBytes(p.freeBytes) }); show(sd, true); } else show(sd, false);
  // advanced view text
  const tag = $('inst-tag');
  if (inst) { tag.textContent = T('adv.installed', { v: inst.version }); show(tag, true); } else show(tag, false);
  let s = '';
  if (p) {
    if (p.todoCount === 0) s = T('setup.upToDate');
    else s = `${T('adv.summary', { v: p.version, n: p.todoCount, m: p.wantedCount, size: fmtBytes(p.totalBytes) })} · ${p.nvidia ? T('adv.nvidia') : T('adv.noNvidia')}`;
  }
  $('plan-summary').textContent = s;
  const w = $('disk-warn');
  if (disk) { w.textContent = T('setup.err.diskShort', { need: fmtBytes(p.needBytes), free: fmtBytes(p.freeBytes) }); show(w, true); } else show(w, false);
  if (r && r.error && !installing) {
    const c = classify(r.error);
    msg($('inst-msg'), c.text, 'warn');
    if (view === 'simple' && !retryTimer) showError(c, () => loadPlan(true));
  } else if (!installing) msg($('inst-msg'), '');
  refreshGo();
}
async function loadPlan(autoStart) {
  if (installing) return;
  const seq = ++planSeq;
  $('s-go').disabled = true; $('go').disabled = true;
  const r = await Y.plan({ manifestUrl: $('manifest').value, dest: $('dest').value });
  if (seq !== planSeq || installing) return;
  planRes = r;
  if (!r.error) hideError();
  renderPlan();
  const p = r.plan;
  // fresh (or interrupted) install: start by itself — the user already chose to install Yukti
  if (autoStart && view === 'simple' && p && p.todoCount > 0 && !(r.installed && r.installed.version) && !lowDisk(p)) runInstall();
}
let planTimer = null;
const replanSoon = () => { clearTimeout(planTimer); planTimer = setTimeout(() => loadPlan(false), 600); };
$('dest').addEventListener('input', replanSoon);
$('manifest').addEventListener('input', replanSoon);

// ---------------------------------------------------------------- errors (simple view)
let lastError = '';
function hideError() { clearInterval(retryTimer); retryTimer = null; show($('s-err'), false); show($('s-retrying'), false); }
function showError(c, retryFn) {
  hideError();
  $('s-err-text').textContent = c.text;
  show($('s-err'), true);
  if (c.auto) {   // no internet: keep trying by itself every 20 s
    let left = 20;
    const tick = () => { $('s-retrying').textContent = T('setup.err.retryIn', { s: left }); };
    show($('s-retrying'), true); tick();
    retryTimer = setInterval(() => { left -= 1; tick(); if (left <= 0) { hideError(); retryFn(); } }, 1000);
  }
}
$('s-retry').addEventListener('click', () => { hideError(); if (planRes && planRes.plan) runInstall(); else loadPlan(true); });
$('s-report').addEventListener('click', () => Y.report({ context: `${$('s-err-text').textContent}\n${lastError}` }));

// ---------------------------------------------------------------- install progress
let speed = 0, last = null;
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
    for (const [bar, fill] of [['bar', 'bar-fill'], ['s-bar', 's-bar-fill']]) { $(bar).classList.remove('indet'); $(fill).style.width = p.pct + '%'; }
    const left = T('setup.progress', { done: fmtBytes(p.doneBytes), total: fmtBytes(p.totalBytes), pct: p.pct });
    const right = speed > 0 ? T('setup.speed', { speed: (speed / 2 ** 20).toFixed(1), eta: fmtEta((p.totalBytes - p.doneBytes) / speed) }) : T('setup.measuring');
    $('p-left').textContent = left; $('s-left').textContent = left;
    $('p-right').textContent = right; $('s-right').textContent = right;
    if (p.artifactTotal) setRow(p.artifact, { state: 'downloading', pct: Math.min(100, Math.floor((100 * p.artifactDone) / p.artifactTotal)) });
    return;
  }
  if (p.phase === 'verify' || p.phase === 'install') {
    const txt = p.phase === 'verify' ? T('setup.verifying') : T('setup.unpacking');
    $('p-right').textContent = txt; $('s-right').textContent = txt;
  }
  if (p.phase === 'done') { $('bar-fill').style.width = '100%'; $('s-bar-fill').style.width = '100%'; }
  if (p.message && view === 'advanced') msg($('inst-msg'), p.message, p.phase === 'retry' ? 'warn' : '');
});

function setInstalling(on) {
  installing = on;
  document.querySelectorAll('.opt:not(#opt-install)').forEach((o) => o.classList.toggle('locked', on));
  ['dest', 'manifest', 'browse-dest'].forEach((id) => { $(id).disabled = on; });
  for (const id of ['pause', 's-pause']) { show($(id), on); $(id).disabled = false; $(id).textContent = T('setup.pause'); }
  show($('back'), !on && !!(cfg && cfg.canGoBack));
  show($('s-more'), !on);
  refreshGo();
}

async function runInstall() {
  hideError();
  show($('inst-err'), false);
  msg($('go-msg'), ''); msg($('s-msg'), '');
  speed = 0; last = null;
  for (const [pr, bar] of [['progress', 'bar'], ['s-progress', 's-bar']]) { show($(pr), true); $(bar).classList.add('indet'); }
  $('p-left').textContent = T('setup.preparing'); $('s-left').textContent = T('setup.preparing');
  $('p-right').textContent = ''; $('s-right').textContent = '';
  setInstalling(true);
  const r = await Y.install({ manifestUrl: $('manifest').value, dest: $('dest').value });
  if (r.ok) {
    msg($('inst-msg'), T('setup.done'), 'ok'); msg($('s-msg'), T('setup.done'), 'ok');
    show($('s-pause'), false); show($('pause'), false);
    return;   // the main process switches this window to the start-up page
  }
  setInstalling(false);
  for (const bar of ['bar', 's-bar']) $(bar).classList.remove('indet');
  if (r.cancelled) {
    msg($('inst-msg'), T('setup.paused'), 'warn'); msg($('s-msg'), T('setup.paused'), 'warn');
    for (const [n, row] of rows) if (row.state === 'downloading') setRow(n, { state: 'paused' });
    $('s-go').textContent = T('setup.resume'); $('go').textContent = T('setup.resume');
    return;
  }
  lastError = r.error || '';
  for (const [n, row] of rows) if (row.state === 'downloading' || row.state === 'verifying') setRow(n, { state: 'error' });
  const c = classify(r.error);
  if (view === 'simple') showError(c, runInstall);
  else { $('inst-err-text').textContent = `${c.text}\n\n${r.error}`; show($('inst-err'), true); }
}

for (const id of ['pause', 's-pause']) {
  $(id).addEventListener('click', () => {
    for (const b of ['pause', 's-pause']) { $(b).disabled = true; $(b).textContent = T('setup.pausing'); }
    Y.cancelInstall();
  });
}
$('retry').addEventListener('click', (e) => { e.stopPropagation(); runInstall(); });
$('inst-logs').addEventListener('click', (e) => { e.stopPropagation(); Y.openLogs('desktop'); });

// ---------------------------------------------------------------- simple view main button
$('s-go').addEventListener('click', async () => {
  if (installing) return;
  const p = planRes && planRes.plan;
  const inst = planRes && planRes.installed && planRes.installed.version;
  if (!p) return loadPlan(true);
  if (inst && p.todoCount === 0) return startInstalled();
  return runInstall();
});
$('s-later').addEventListener('click', () => { if (!installing) startInstalled(); });
async function startInstalled() {
  $('s-go').disabled = true; $('go').disabled = true;
  msg($('s-msg'), T('adv.starting')); msg($('go-msg'), T('adv.starting'));
  const r = await Y.connect({ mode: 'local', installRoot: $('dest').value });
  if (!r.ok) { $('s-go').disabled = false; $('go').disabled = false; msg($('s-msg'), r.error, 'err'); msg($('go-msg'), r.error, 'err'); }
}

// ---------------------------------------------------------------- advanced view
function select(m) {
  if (installing) return;
  mode = m;
  for (const k of ['install', 'remote', 'local']) { $('r-' + k).checked = m === k; $('opt-' + k).classList.toggle('sel', m === k); }
  refreshGo();
}
document.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => select(o.dataset.mode)));
$('test').addEventListener('click', async (e) => {
  e.stopPropagation(); select('remote');
  $('test').disabled = true; msg($('test-msg'), T('adv.testing'));
  const r = await Y.test($('url').value);
  $('test').disabled = false;
  if (r.ok) msg($('test-msg'), T('adv.connected', { v: r.version, base: r.base }), 'ok');
  else msg($('test-msg'), T('adv.failed', { err: r.error }), 'err');
});
$('browse').addEventListener('click', async (e) => { e.stopPropagation(); select('local'); const p = await Y.browseRoot(); if (p) $('root').value = p; });
$('browse-dest').addEventListener('click', async (e) => { e.stopPropagation(); select('install'); const p = await Y.browseRoot(); if (p) { $('dest').value = p; loadPlan(false); } });
$('back').addEventListener('click', () => Y.back());
$('go').addEventListener('click', async () => {
  if (installing) return;
  if (mode === 'install') {
    const p = planRes && planRes.plan;
    const inst = planRes && planRes.installed && planRes.installed.version;
    if (inst && (!p || p.todoCount === 0)) return startInstalled();
    return runInstall();
  }
  $('go').disabled = true;
  msg($('go-msg'), mode === 'local' ? T('adv.starting') : T('adv.connecting'));
  const r = await Y.connect({ mode, serverUrl: $('url').value, installRoot: $('root').value });
  if (!r.ok) { $('go').disabled = false; msg($('go-msg'), r.error, 'err'); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || installing || e.target.tagName === 'BUTTON') return;
  const b = view === 'simple' ? $('s-go') : $('go');
  if (!b.disabled) b.click();
});

// ---------------------------------------------------------------- init
(async () => {
  cfg = await Y.getConfig();
  lang = cfg.lang || 'en';
  $('ver').textContent = 'v' + cfg.version;
  $('url').value = cfg.mode === 'remote' ? cfg.serverUrl : '';
  $('root').value = cfg.installRoot || '';
  $('dest').value = cfg.dest;
  $('manifest').value = cfg.manifestUrl || '';
  applyI18n();
  show($('back'), !!cfg.canGoBack);
  if (cfg.notice) { $('notice').textContent = cfg.notice; show($('notice'), true); }
  if (cfg.bundled) show($('opt-install'), false);
  // simple view for normal installs; the advanced view when this build has no download source or a plant server is set up
  const simple = !cfg.bundled && !!cfg.manifestUrl && cfg.defaultMode !== 'remote';
  select(cfg.defaultMode || (simple ? 'install' : 'remote'));
  setView(simple ? 'simple' : 'advanced');
  await loadPlan(simple);
  document.body.dataset.ready = '1';
})();
