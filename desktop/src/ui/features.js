'use strict';
// Add-ons page (file:// only, inside the main Yukti window): switch photos / voice on or off on the server computer.
const $ = (id) => document.getElementById(id);
const Y = window.yukti;
let lang = 'en';
const T = (k, v) => window.YI.t(lang, k, v);
const FEATS = ['vision', 'voice'];
let plan = null;
let busy = null;            // feature being downloaded / removed
const st = {};              // per feature: {msg, cls, pct, left, right, removing, pausing}
let backError = '';         // why "Back to Yukti" could not be done (shown in the banner)

const fmtBytes = (b) => (b == null ? '' : b >= 2 ** 30 ? (b / 2 ** 30).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 2 ** 20)) + ' MB');
const card = (f) => $('f-' + f);
const q = (f, sel) => card(f).querySelector(sel);
// classList.toggle(x, undefined) TOGGLES instead of hiding: every condition is forced to a real boolean
const show = (el, on) => el.classList.toggle('hidden', !on);

/** Installer / network errors → plain words. plain = the main process already sent a sentence in the user's language. */
function plainError(e, plain) {
  e = String(e || '');
  if (plain) return e;
  // office networks first (their error names also contain words like "signature" or "network")
  if (/ERR_PROXY|ERR_TUNNEL_CONNECTION|ERR_MANDATORY_PROXY|\(407\)|proxy/i.test(e)) return T('setup.err.proxy');
  if (/ERR_CERT|ERR_SSL|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|certificate/i.test(e)) return T('setup.err.cert');
  if (/signature/i.test(e)) return T('setup.err.signature');
  if (/checksum/i.test(e)) return T('setup.err.damaged');
  if (/disk space|ENOSPC|no space|disk full/i.test(e)) return T('feat.err.disk');
  if (/cancel/i.test(e)) return T('feat.paused');
  if (/fetch failed|net::ERR_|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket|terminated|aborted|premature|stalled|UND_ERR|timed? ?out|\((4\d\d|5\d\d)\)/i.test(e)) return T('feat.err.network');
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
  let noteText = '';
  if (backError) noteText = backError;
  else if (plan && !plan.local) noteText = plan.bundled ? T('feat.bundled') : T('feat.remote', { url: plan.serverUrl || '' });
  else if (plan && plan.updatePending) noteText = T('feat.update');
  note.textContent = noteText;
  note.className = `banner ${backError ? 'warn' : 'info'}${noteText ? '' : ' hidden'}`;
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
    // Pause was clicked: say so at once (it takes effect at the next safe moment, which can take a little while)
    cancel.disabled = !!s.pausing;
    if (s.pausing) cancel.textContent = T('setup.pausing');
    show(q(f, '.progress'), downloading);
    if (downloading) {
      q(f, '.bar > div').style.width = (s.pct || 0) + '%';
      q(f, '.l').textContent = s.left || '';
      q(f, '.r').textContent = s.right || '';
    }
    const m = q(f, '.msg');
    let msg = s.msg;
    if (!msg && !plan) msg = T('feat.loading');
    else if (!msg && plan && plan.local && !plan.ok && !on) msg = plainError(plan.error, plan.plain);
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
  // the page was reloaded while an add-on downloads (or is removed): keep showing it (progress events continue)
  if (plan && plan.busy && !busy) {
    busy = plan.busy;
    st[busy] = { ...(st[busy] || {}), msg: plan.removing ? T('feat.removing') : T('feat.downloading'), removing: !!plan.removing, pct: (st[busy] || {}).pct || 0 };
    watchBusy();
  }
  render();
  // no internet yet: look again by itself, so the Add buttons appear once the connection is back
  clearTimeout(retryTimer);
  if (plan && plan.local && !plan.ok && !plan.plain) retryTimer = setTimeout(() => { if (!busy) load(); }, 15000);
}
let retryTimer = 0;

/**
 * A download / removal ended. The news arrives twice — as the answer to the call that started it and as a "finished"
 * event — and a page that was reloaded meanwhile only gets the event (or finds out by asking, see watchBusy). Whichever
 * comes first is used; the others find nothing left to do.
 */
async function finish(f, r) {
  if (!f || busy !== f) return;
  busy = null;
  clearInterval(pollTimer);
  r = r || {};
  if (r.unknown) st[f] = {};   // how it ended is not known: show what is on this computer now
  else if (r.removing) st[f] = r.ok ? { msg: T('feat.removed'), cls: 'ok' } : { msg: r.plain ? r.error : T('feat.err.remove', { msg: r.error || '' }), cls: 'err' };
  // "Yukti restarts now": the main process does that by itself a moment later
  else if (r.ok) st[f] = { msg: r.restart ? T('feat.doneRestart') : T(`feat.done.${f}`), cls: 'ok' };
  else st[f] = { msg: r.cancelled ? T('feat.paused') : plainError(r.error, r.plain), cls: r.cancelled ? 'warn' : 'err' };
  await load();
}

// Safety net while something runs: ask now and then whether it still does (cheap, no internet). Without it a missed
// "finished" message would leave this page waiting for ever.
let pollTimer = 0;
function watchBusy() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!busy) { clearInterval(pollTimer); return; }
    let s;
    try { s = await Y.featuresPlan({ stateOnly: true }); } catch { return; }
    if (busy && s && !s.busy) finish(busy, s.last && s.last.feature === busy ? s.last : { unknown: true });
  }, 4000);
}

let t0 = 0, firstBytes = null;
Y.onInstallProgress((p) => {
  if (p.phase === 'finished') { finish(p.feature, p); return; }
  if (!busy && p.feature && FEATS.includes(p.feature)) { busy = p.feature; watchBusy(); }
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
    if (!s.pausing) s.msg = T('feat.downloading');
  } else if (s.pausing) { /* keep "Pausing…" until it has stopped */ }
  else if (p.phase === 'verify') s.msg = T('feat.checking');
  else if (p.phase === 'install') s.msg = T('feat.installing');
  else if (p.phase === 'retry') s.msg = T('feat.retrying');
  s.cls = '';
  render();
});

async function add(f) {
  if (busy) return;
  busy = f; t0 = Date.now(); firstBytes = null;
  backError = '';
  st[f] = { msg: T('feat.starting'), pct: 0 };
  render();
  watchBusy();
  let r;
  try { r = await Y.featureInstall(f); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  await finish(f, r);
}

async function remove(f) {
  if (busy) return;
  if (!window.confirm(T('feat.removeConfirm', { name: T(`feat.${f}.title`) }))) return;
  busy = f;
  backError = '';
  st[f] = { msg: T('feat.removing'), removing: true };
  render();
  watchBusy();
  let r;
  try { r = await Y.featureRemove(f); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  await finish(f, { ...r, removing: true });
}

for (const f of FEATS) {
  q(f, '.add').addEventListener('click', () => add(f));
  q(f, '.remove').addEventListener('click', () => remove(f));
  q(f, '.cancel').addEventListener('click', () => {
    if (busy !== f || (st[f] || {}).removing) return;
    st[f] = { ...(st[f] || {}), pausing: true, msg: T('setup.pausing'), cls: '' };
    render();
    Y.cancelInstall();
  });
}
// Back to Yukti: the main process knows whether Yukti must be restarted first (an add-on needs it, or it was stopped)
$('back').addEventListener('click', async () => {
  if (busy) return;
  let r;
  try { r = await Y.featuresDone(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  if (r && !r.ok && r.error) { backError = r.error; render(); }
});
// the language was changed in the menu: change the texts in place (a reload would lose the progress of a download)
Y.onLang((l) => { lang = l; render(); });

(async () => {
  try { lang = (await Y.getConfig()).lang || 'en'; } catch { /* keep English */ }
  render();
  const want = new URLSearchParams(location.search).get('add');
  // the request in the address is used once: without this, every reload of this page would start the download again
  try { history.replaceState(null, '', location.pathname); } catch { /* address stays as it is */ }
  await load();
  const info = FEATS.includes(want) ? infoOf(want) : null;
  // arrived from the "Add" button on the Yukti home page: start right away (the size was shown on that button)
  if (want && !busy && plan && plan.ok && plan.local && info && !(info.on && (info.present || info.installed))) {
    card(want).scrollIntoView({ block: 'center' });
    add(want);
  }
})();
