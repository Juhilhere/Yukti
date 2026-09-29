'use strict';
const $ = (id) => document.getElementById(id);
const logEl = $('log');

window.yukti.onLog((line) => {
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  logEl.textContent += line + '\n';
  if (logEl.textContent.length > 200000) logEl.textContent = logEl.textContent.slice(-150000);
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
});

window.yukti.onStatus((s) => {
  $('status').textContent = s.text;
  $('status').className = 'msg ' + (s.error ? 'err' : '');
  if (typeof s.pct === 'number') $('bar').style.width = s.pct + '%';
  if (typeof s.secs === 'number') $('elapsed').textContent = `${s.secs}s elapsed`;
  if (s.error) { $('retry').classList.remove('hidden'); $('det').open = true; }
});

$('settings').addEventListener('click', () => window.yukti.splashAction('settings'));
$('retry').addEventListener('click', () => window.yukti.splashAction('retry'));
$('quit').addEventListener('click', () => window.yukti.splashAction('quit'));
