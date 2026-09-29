'use strict';
const $ = (id) => document.getElementById(id);
let mode = 'remote';

function select(m) {
  mode = m;
  $('r-remote').checked = m === 'remote';
  $('r-local').checked = m === 'local';
  $('opt-remote').classList.toggle('sel', m === 'remote');
  $('opt-local').classList.toggle('sel', m === 'local');
  $('go').textContent = m === 'local' ? 'Start Yukti' : 'Connect';
}
function msg(el, text, kind) { el.textContent = text; el.className = 'msg ' + (kind || ''); }

document.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => select(o.dataset.mode)));

$('test').addEventListener('click', async (e) => {
  e.stopPropagation(); select('remote');
  $('test').disabled = true; msg($('test-msg'), 'Testing…');
  const r = await window.yukti.test($('url').value);
  $('test').disabled = false;
  if (r.ok) msg($('test-msg'), `Connected: Yukti v${r.version} at ${r.base} — engine: ${r.engine}`, 'ok');
  else msg($('test-msg'), `Failed: ${r.error}`, 'err');
});

$('browse').addEventListener('click', async (e) => {
  e.stopPropagation(); select('local');
  const p = await window.yukti.browseRoot();
  if (p) $('root').value = p;
});

$('go').addEventListener('click', async () => {
  $('go').disabled = true; msg($('go-msg'), mode === 'local' ? 'Starting…' : 'Connecting…');
  const r = await window.yukti.connect({ mode, serverUrl: $('url').value, installRoot: $('root').value });
  if (!r.ok) { $('go').disabled = false; msg($('go-msg'), r.error, 'err'); }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });

window.yukti.getConfig().then((c) => {
  $('ver').textContent = 'v' + c.version;
  $('url').value = c.mode === 'remote' ? c.serverUrl : (c.serverUrl || 'http://127.0.0.1:8000');
  $('root').value = c.installRoot || '';
  select(c.mode || 'remote');
});
