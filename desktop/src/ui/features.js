'use strict';
// Add-ons page (file:// only, inside the main Yukti window): switch photos / voice on or off on the server computer.
const $ = (id) => document.getElementById(id);
const Y = window.yukti;
let lang = 'en';
const T = (k, v) => window.YI.t(lang, k, v);
const FEATS = ['vision', 'voice'];
let plan = null;
let busy = null;            // feature being downloaded / removed
const st = {};              // per feature: {msg, cls, pct, left, right}
let needRestart = false;

const fmtBytes = (b) => (b == null ? '' : b >= 2 ** 30 ? (b / 2 ** 30).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 2 ** 20)) + ' MB');
const card = (f) => $('f-' + f);
const q = (f, sel) => card(f).querySelector(sel);
// classList.toggle(x, undefined) TOGGLES instead of hiding: every condition is forced to a real boolean
const show = (el, on) => el.classList.toggle('hidden', !on);

function plainError(e) {
  e = String(e || '');
  if (/signature/i.test(e)) return T('setup.err.signature');
  if (/checksum/i.test(e)) return T('setup.err.damaged');
  if (/disk space/i.test(e)) return T('feat.err.disk');
  if (/cancel/i.test(e)) return T('feat.paused');
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket|terminated|UND_ERR|timed? ?out|\((4\d\d|5\d\d)\)/i.test(e)) return T('feat.err.network');
  return T('feat.err.other', { msg: e });
}

/** What is known about an add-on: from the release (online) or, without internet, from this computer alone. */
function infoOf(f) {
  if (plan && plan.features && plan.features[f]) return plan.features[f];
  const k = plan && plan.known && plan.known[f];
  return k ? { on: k.on, present: k.present, installed: k.present, size: null, offline: true } : null;
}

function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  const note = $('note');
  note.classList.add('hidden');
  if (plan && !plan.local) {
    note.textContent = plan.bundled ? T('feat.bundled') : T('feat.remote', { url: plan.serverUrl || '' });
    note.classList.remove('hidden');
  } else if (plan && plan.updatePending) {
    note.textContent = T('feat.update');
    note.classList.remove('hidden');
  }
  const online = !!(plan && plan.ok && plan.local);
  for (const f of FEATS) {
    const info = infoOf(f);
    const add = q(f, '.add'), rem = q(f, '.remove'), cancel = q(f, '.cancel'), state = q(f, '.state');
    const s = st[f] || {};
    // "added" = switched on and its files are on this computer (it works), even when a newer version is waiting
    const on = !!(info && info.on && (info.present || info.installed));
    const update = on && online && !info.installed;
    state.textContent = on ? T('feat.added') : '';
    state.className = 'state tag' + (on ? '' : ' hidden');
    show(add, online && !!info && (!on || update) && busy !== f);
    add.textContent = !info ? '' : update ? T('feat.updateBtn', { size: fmtBytes(info.sizeTodo || info.size) }) : T('feat.add', { size: fmtBytes(info.size) });
    add.disabled = !!busy;
    show(rem, on && !busy && !!(plan && plan.local));
    const downloading = busy === f && !s.removing;
    show(cancel, downloading);
    show(q(f, '.progress'), downloading);
    if (downloading) {
      q(f, '.bar > div').style.width = (s.pct || 0) + '%';
      q(f, '.l').textContent = s.left || '';
      q(f, '.r').textContent = s.right || '';
    }
    const m = q(f, '.msg');
    let msg = s.msg;
    if (!msg && !plan) msg = T('feat.loading');
    else if (!msg && plan && plan.local && !plan.ok && !on) msg = plainError(plan.error);
    else if (!msg && online && !info) msg = T('feat.notInRelease');
    m.textContent = msg || '';
    m.className = 'msg' + (s.cls ? ' ' + s.cls : !s.msg && plan && plan.local && !plan.ok && !on ? ' warn' : '');
  }
  $('free').textContent = plan && plan.freeBytes != null && plan.local ? T('feat.free', { size: fmtBytes(plan.freeBytes) }) : '';
  $('back').disabled = !!busy;
}

async function load() {
  try {
    plan = await Y.featuresPlan();
  } catch (e) {
    plan = { ok: false, local: true, error: String(e && e.message || e), known: {} };
  }
  // the page was reloaded while an add-on downloads: keep showing that download (progress events continue)
  if (plan && plan.busy && !busy) { busy = plan.busy; st[busy] = { ...(st[busy] || {}), msg: T('feat.downloading'), pct: (st[busy] || {}).pct || 0 }; }
  render();
  // no internet yet: look again by itself, so the Add buttons appear once the connection is back
  clearTimeout(retryTimer);
  if (plan && plan.local && !plan.ok) retryTimer = setTimeout(() => { if (!busy) load(); }, 15000);
}
let retryTimer = 0;

let t0 = 0, firstBytes = null;
Y.onInstallProgress((p) => {
  if (!busy && p.feature && FEATS.includes(p.feature)) busy = p.feature;
  if (!busy) return;
  const s = st[busy] = st[busy] || {};
  if (p.phase === 'download' && p.totalBytes) {
    s.pct = p.pct;
    // speed from the bytes downloaded in THIS session (a resumed download starts with bytes that took no time)
    if (firstBytes === null) { firstBytes = p.doneBytes; t0 = Date.now(); }
    const secs = (Date.now() - t0) / 1000;
    const rate = secs > 3 ? (p.doneBytes - firstBytes) / secs : 0;
    s.left = `${fmtBytes(p.doneBytes)} / ${fmtBytes(p.totalBytes)}`;
    s.right = rate > 0 ? T('feat.left', { min: Math.max(1, Math.round((p.totalBytes - p.doneBytes) / rate / 60)) }) : '';
    s.msg = T('feat.downloading');
  } else if (p.phase === 'verify') s.msg = T('feat.checking');
  else if (p.phase === 'install') s.msg = T('feat.installing');
  else if (p.phase === 'retry') s.msg = T('feat.retrying');
  s.cls = '';
  render();
});

async function add(f) {
  if (busy) return;
  busy = f; t0 = Date.now(); firstBytes = null;
  st[f] = { msg: T('feat.starting'), pct: 0 };
  render();
  let r;
  try { r = await Y.featureInstall(f); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  busy = null;
  if (r.ok) {
    st[f] = { msg: r.restart ? T('feat.doneRestart') : T(`feat.done.${f}`), cls: 'ok' };
    needRestart = needRestart || !!r.restart;
    await load();
    if (r.restart) setTimeout(() => Y.featuresDone({ restart: true }), 2500);
  } else {
    if (r.stopped) needRestart = true;   // Yukti was stopped for an update that did not finish: start it again on Back
    st[f] = { msg: r.cancelled ? T('feat.paused') : plainError(r.error), cls: r.cancelled ? 'warn' : 'err' };
    await load();
  }
}

async function remove(f) {
  if (busy) return;
  if (!window.confirm(T('feat.removeConfirm', { name: T(`feat.${f}.title`) }))) return;
  busy = f;
  st[f] = { msg: T('feat.removing'), removing: true };
  render();
  let r;
  try { r = await Y.featureRemove(f); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  busy = null;
  st[f] = r.ok ? { msg: T('feat.removed'), cls: 'ok' } : { msg: plainError(r.error), cls: 'err' };
  needRestart = needRestart || !!(r.ok && r.restart);
  await load();
}

for (const f of FEATS) {
  q(f, '.add').addEventListener('click', () => add(f));
  q(f, '.remove').addEventListener('click', () => remove(f));
  q(f, '.cancel').addEventListener('click', () => Y.cancelInstall());
}
$('back').addEventListener('click', () => { if (!busy) Y.featuresDone({ restart: needRestart }); });

(async () => {
  try { lang = (await Y.getConfig()).lang || 'en'; } catch { /* keep English */ }
  render();
  await load();
  const want = new URLSearchParams(location.search).get('add');
  const info = FEATS.includes(want) ? infoOf(want) : null;
  // arrived from the "Add" button on the Yukti home page: start right away (the size was shown on that button)
  if (want && !busy && plan && plan.ok && plan.local && info && !(info.on && (info.present || info.installed))) {
    card(want).scrollIntoView({ block: 'center' });
    add(want);
  }
})();
