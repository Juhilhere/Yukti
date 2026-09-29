'use strict';
// Startup page (runs inside the main Yukti window, file:// only). Main process polls /api/health and sends status.
const $ = (id) => document.getElementById(id);
const Y = window.yukti;
const logEl = $('log');
let toastShown = false;

function appendLog(line) {
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  logEl.textContent += line + '\n';
  if (logEl.textContent.length > 200000) logEl.textContent = logEl.textContent.slice(-150000);
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

function setStep(id, state, right, detail, pct) {
  const li = $(id);
  li.className = state || '';
  li.querySelector('.r').textContent = right || '';
  li.querySelector('.d').textContent = detail || '';
  let mini = li.querySelector('.mini');
  if (pct != null) {
    if (!mini) { mini = document.createElement('div'); mini.className = 'mini'; mini.appendChild(document.createElement('div')); li.appendChild(mini); }
    mini.firstChild.style.width = pct + '%';
  } else if (mini) mini.remove();
}

const fmtSecs = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

function render(s) {
  if (!s) return;
  if (s.url) $('sub').textContent = `All-in-one mode · local server ${s.url.replace(/^https?:\/\//, '')}`;
  if (typeof s.secs === 'number') $('elapsed').textContent = fmtSecs(s.secs);
  const h = s.health || null;
  const up = !!(s.up && h);
  const kr = up ? (h.knowledge_ready !== undefined ? h.knowledge_ready : h.progress == null) : false;
  const eng = up ? h.engine : null;

  // 1 server
  if (!up) setStep('s-server', s.failed ? 'failed' : 'active', s.step === 'check' ? 'checking' : 'starting', s.step === 'check' ? s.text : '');
  else setStep('s-server', 'done', h.version ? `v${h.version}` : 'up');
  // 2 knowledge base
  if (!up) setStep('s-kb', '');
  else if (!kr) {
    const p = h.progress;
    const pct = p && p.total ? Math.round((100 * p.done) / p.total) : null;
    setStep('s-kb', s.failed ? 'failed' : 'active', p && p.total ? `${p.done}/${p.total}` : 'working', h.stage || '', pct);
  } else setStep('s-kb', 'done', 'done');
  // 3 model
  if (!up || !kr) setStep('s-model', eng === 'loading' ? 'active' : '', eng === 'loading' ? 'loading' : '');
  else if (eng === 'loading' || eng === 'restarting') setStep('s-model', s.failed ? 'failed' : 'active', eng, h.stage || '');
  else if (eng === 'ready') setStep('s-model', 'done', 'loaded');
  else if (eng === 'idle') setStep('s-model', 'skipped', 'no model loaded', 'An administrator can load a model under Models.');
  else if (eng === 'error') setStep('s-model', 'failed', 'failed', h.error || 'The AI model could not be loaded.');
  // 4 ready
  const ready = s.done || (up && h.ready === true);
  setStep('s-ready', ready ? 'done' : '', ready ? 'opening Yukti…' : '');
  if (ready) $('title').textContent = 'Opening Yukti';

  $('stage').textContent = s.failed ? '' : up ? (h.stage || `engine: ${eng}`) : s.reachError && s.step === 'wait' ? 'Waiting for the server to answer…' : '';
  $('slow').classList.toggle('hidden', !(s.secs >= 60 && !s.failed && !ready));

  if (s.notice && !toastShown) {
    toastShown = true;
    $('toast').textContent = s.notice;
    $('toast').classList.add('show');
  }

  const err = $('err');
  if (s.failed) {
    $('title').textContent = 'Yukti could not start';
    $('err-text').textContent = s.error || 'Unknown error';
    $('err-tail').textContent = (s.tail || []).join('\n') || '(no server output)';
    $('open').classList.toggle('hidden', !s.canOpen);
    err.classList.remove('hidden');
    $('settings').classList.add('hidden');
    requestAnimationFrame(() => { $('err-tail').scrollTop = $('err-tail').scrollHeight; });
  } else {
    err.classList.add('hidden');
    $('settings').classList.remove('hidden');
    if (!ready) $('title').textContent = 'Starting Yukti';
  }
}

Y.onLog(appendLog);
Y.onStatus(render);

const act = (a) => () => Y.splashAction(a);
$('settings').addEventListener('click', act('settings'));
$('settings2').addEventListener('click', act('settings'));
$('retry').addEventListener('click', () => { $('err').classList.add('hidden'); toastShown = false; Y.splashAction('retry'); });
$('open').addEventListener('click', act('open'));
$('logs').addEventListener('click', act('logs'));
$('quit').addEventListener('click', act('quit'));

Y.splashInit().then((i) => {
  (i.logs || []).forEach(appendLog);
  if (i.status) render(i.status);
});
