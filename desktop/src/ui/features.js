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

function plainError(e) {
  e = String(e || '');
  if (/signature/i.test(e)) return T('setup.err.signature');
  if (/checksum/i.test(e)) return T('setup.err.damaged');
  if (/disk space/i.test(e)) return T('feat.err.disk');
  if (/cancel/i.test(e)) return T('feat.paused');
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket|terminated|UND_ERR|\((4\d\d|5\d\d)\)/i.test(e)) return T('feat.err.network');
  return T('feat.err.other', { msg: e });
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
  for (const f of FEATS) {
    const info = plan && plan.features && plan.features[f];
    const add = q(f, '.add'), rem = q(f, '.remove'), cancel = q(f, '.cancel'), state = q(f, '.state');
    const s = st[f] || {};
    const on = !!(info && info.on && info.installed);
    state.textContent = on ? T('feat.added') : '';
    state.className = 'state tag' + (on ? '' : ' hidden');
    add.classList.toggle('hidden', on || busy === f || !(plan && plan.local && info));
    add.textContent = info ? T('feat.add', { size: fmtBytes(info.size) }) : '';
    add.disabled = !!busy;
    rem.classList.toggle('hidden', !on || !!busy);
    cancel.classList.toggle('hidden', busy !== f || s.removing);
    const prog = q(f, '.progress');
    prog.classList.toggle('hidden', busy !== f || s.removing);
    if (busy === f) {
      q(f, '.bar > div').style.width = (s.pct || 0) + '%';
      q(f, '.l').textContent = s.left || '';
      q(f, '.r').textContent = s.right || '';
    }
    const m = q(f, '.msg');
    m.textContent = s.msg || (plan && plan.local && !info ? T('feat.notInRelease') : '');
    m.className = 'msg' + (s.cls ? ' ' + s.cls : '');
  }
  $('free').textContent = plan && plan.freeBytes != null && plan.local ? T('feat.free', { size: fmtBytes(plan.freeBytes) }) : '';
  $('back').disabled = !!busy;
}

async function load() {
  plan = await Y.featuresPlan();
  if (!plan.ok) for (const f of FEATS) st[f] = { msg: plainError(plan.error), cls: 'warn' };
  render();
}

let t0 = 0, lastBytes = 0;
Y.onInstallProgress((p) => {
  if (!busy) return;
  const s = st[busy] = st[busy] || {};
  if (p.phase === 'download' && p.totalBytes) {
    s.pct = p.pct;
    const secs = (Date.now() - t0) / 1000;
    const rate = secs > 3 ? (p.doneBytes - lastBytes) / secs : 0;
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
  busy = f; t0 = Date.now(); lastBytes = 0;
  st[f] = { msg: T('feat.starting'), pct: 0 };
  render();
  const r = await Y.featureInstall(f);
  busy = null;
  if (r.ok) {
    st[f] = { msg: r.restart ? T('feat.doneRestart') : T(`feat.done.${f}`), cls: 'ok' };
    needRestart = needRestart || !!r.restart;
    await load();
    if (r.restart) setTimeout(() => Y.featuresDone({ restart: true }), 2500);
  } else {
    st[f] = { msg: r.cancelled ? T('feat.paused') : plainError(r.error), cls: r.cancelled ? 'warn' : 'err' };
    render();
  }
}

async function remove(f) {
  if (busy) return;
  busy = f;
  st[f] = { msg: T('feat.removing'), removing: true };
  render();
  const r = await Y.featureRemove(f);
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
  const cfg = await Y.getConfig();
  lang = cfg.lang || 'en';
  render();
  await load();
  const want = new URLSearchParams(location.search).get('add');
  const info = plan && plan.features && plan.features[want];
  // arrived from the "Add" button on the Yukti home page: start right away (the size was shown on that button)
  if (want && plan.local && info && !(info.on && info.installed)) { card(want).scrollIntoView({ block: 'center' }); add(want); }
})();
