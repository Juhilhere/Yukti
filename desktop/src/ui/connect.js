'use strict';
const $ = (id) => document.getElementById(id);
let mode = 'install';
let installing = false;
let info = null;

const LABEL = { install: 'Install', remote: 'Connect', local: 'Start Yukti' };
function select(m) {
  if (installing) return;
  mode = m;
  for (const k of ['install', 'remote', 'local']) {
    $('r-' + k).checked = m === k;
    $('opt-' + k).classList.toggle('sel', m === k);
  }
  $('go').textContent = m === 'install' && info && info.installed ? (info.updateAvailable ? 'Update & start' : 'Start Yukti') : LABEL[m];
}
function msg(el, text, kind) { el.textContent = text; el.className = 'msg ' + (kind || ''); }
const gb = (b) => (b / 2 ** 30).toFixed(2) + ' GB';

document.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => select(o.dataset.mode)));
document.querySelectorAll('input, details').forEach((i) => i.addEventListener('click', (e) => e.stopPropagation()));

$('test').addEventListener('click', async (e) => {
  e.stopPropagation(); select('remote');
  $('test').disabled = true; msg($('test-msg'), 'Testing…');
  const r = await window.yukti.test($('url').value);
  $('test').disabled = false;
  if (r.ok) msg($('test-msg'), `Connected: Yukti v${r.version} at ${r.base} — engine: ${r.engine}`, 'ok');
  else msg($('test-msg'), `Failed: ${r.error}`, 'err');
});
$('browse').addEventListener('click', async (e) => { e.stopPropagation(); select('local'); const p = await window.yukti.browseRoot(); if (p) $('root').value = p; });
$('browse-dest').addEventListener('click', async (e) => { e.stopPropagation(); select('install'); const p = await window.yukti.browseRoot(); if (p) $('dest').value = p; });

window.yukti.onInstallProgress((p) => {
  if (p.pct !== undefined) { $('bar').hidden = false; $('bar-fill').style.width = p.pct + '%'; }
  if (p.phase === 'download') msg($('inst-msg'), `Downloading ${p.artifact} — ${gb(p.doneBytes)} of ${gb(p.totalBytes)} (${p.pct}%)`);
  else if (p.message) msg($('inst-msg'), p.message, p.phase === 'retry' ? 'err' : '');
});

$('cancel').addEventListener('click', () => window.yukti.cancelInstall());

$('go').addEventListener('click', async () => {
  $('go').disabled = true;
  if (mode === 'install') {
    installing = true; $('cancel').hidden = false;
    msg($('go-msg'), '');
    const r = await window.yukti.install({ manifestUrl: $('manifest').value, dest: $('dest').value });
    installing = false; $('cancel').hidden = true;
    if (!r.ok) { $('go').disabled = false; msg($('inst-msg'), r.error, 'err'); }
    return;
  }
  msg($('go-msg'), mode === 'local' ? 'Starting…' : 'Connecting…');
  const r = await window.yukti.connect({ mode, serverUrl: $('url').value, installRoot: $('root').value });
  if (!r.ok) { $('go').disabled = false; msg($('go-msg'), r.error, 'err'); }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !installing) $('go').click(); });

$('go').disabled = true;
msg($('inst-msg'), 'Checking this PC and the download source…');
Promise.all([window.yukti.getConfig(), window.yukti.installInfo()]).then(([c, i]) => {
  info = i;
  msg($('inst-msg'), '');
  $('go').disabled = false;
  $('ver').textContent = 'v' + c.version;
  $('url').value = c.mode === 'remote' ? c.serverUrl : '';
  $('root').value = c.installRoot || '';
  if (!$('dest').value) $('dest').value = i.dest;
  if (!$('manifest').value) $('manifest').value = i.manifestUrl;
  if (i.installed) {
    $('inst-state').textContent = `Installed: Yukti Server ${i.installed.version} in ${i.dest}` +
      (i.latest ? (i.updateAvailable ? ` · update ${i.latest} available` : ' · up to date') : '');
  } else if (i.latest) {
    $('inst-state').textContent = `Available: Yukti Server ${i.latest} (${gb(i.size)} to download)`;
  } else if (i.error) {
    $('inst-state').textContent = `Download source not reachable (${i.error}). You can still connect to a plant server.`;
  }
  select(c.mode === 'remote' ? 'remote' : c.mode === 'local' && !i.installed ? 'local' : 'install');
});
