// Yukti desktop — Electron main process.
// ONE window ("Yukti") walks through: setup page → install progress → startup page → the Yukti web app, all via
// loadFile / loadURL on the same BrowserWindow.
// Modes: "remote" (connect to a Yukti server on the plant network) or
// "local" (all-in-one: start the Yukti server on this PC as a child process).
// Offline by design: no telemetry, no auto-update, no CDN.
'use strict';
const SUPPORT_EMAIL = 'juhilprogramming@gmail.com';  // problem reports (Help menu)
const YI = require('./ui/i18n.js');
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage, session, screen, net: electronNet } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const installer = require('./installer');

const DEBUG = process.env.YUKTI_DEBUG === '1';
// testing only: run with a separate settings folder so a test never touches a real installation's settings
if (process.env.YUKTI_PROFILE_DIR) app.setPath('userData', path.resolve(process.env.YUKTI_PROFILE_DIR));
const ROOT = path.join(__dirname, '..');
const UI = (f) => path.join(__dirname, 'ui', f);
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const TRAY_PNG = path.join(ROOT, 'build', 'tray.png');
const BG = '#0e0e10';
// testing only (like YUKTI_PROFILE_DIR): a test copy must never serve on 8000, where a real Yukti app would connect to it
const DEFAULT_PORT = Number(process.env.YUKTI_TEST_PORT) || 8000;
const PORT_RANGE = [8001, 8099];
const localUrl = (port) => `http://127.0.0.1:${port}`;
const DEFAULT_DEST = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'Yukti', 'Server');
const DEFAULTS = { mode: null, serverUrl: localUrl(DEFAULT_PORT), installRoot: DEFAULT_DEST, localPort: DEFAULT_PORT, manifestUrl: null, bounds: null, startedOnce: false };
const FIRST_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 5 * 60 * 1000;

// Download source for "Install Yukti on this PC": set at build time in distribution.json (the publisher's website).
// Single-zip distribution: Yukti.exe with the complete Yukti Server in ./server next to it.
const BUNDLED_ROOT = app.isPackaged ? path.join(path.dirname(process.execPath), 'server') : null;
function bundledServer() {
  return BUNDLED_ROOT && fs.existsSync(path.join(BUNDLED_ROOT, 'yukti-server.exe')) ? BUNDLED_ROOT : null;
}
// Windows lets people double-click Yukti.exe inside a zip without extracting it; the server folder is then missing.
function runningFromZipPreview() {
  const exe = process.execPath.toLowerCase();
  const tmp = String(process.env.TEMP || require('os').tmpdir()).toLowerCase();
  return app.isPackaged && !bundledServer() && (exe.startsWith(tmp) || /\\temp\\/.test(exe) || /\.zip\\/.test(exe));
}

// A zip has no installer: create Desktop and Start-menu shortcuts on first run, and repoint them when a newer
// version is extracted to another folder (only shortcuts Yukti created itself are updated).
function ensureShortcuts() {
  if (!app.isPackaged || !bundledServer() || process.platform !== 'win32') return;
  const exe = process.execPath;
  if (config.shortcutExe === exe) return;
  const targets = [
    path.join(app.getPath('desktop'), 'Yukti.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Yukti.lnk'),
  ];
  const opts = { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, description: 'Yukti — Sovereign Industrial AI Workbench' };
  for (const t of targets) {
    try {
      const exists = fs.existsSync(t);
      if (!config.shortcutExe && !exists) shell.writeShortcutLink(t, 'create', opts);
      else if (exists) shell.writeShortcutLink(t, 'replace', opts);
    } catch (e) { log(`[shortcut] ${t}: ${e.message}`); }
  }
  config.shortcutExe = exe; saveConfig();
  log(`[shortcut] Desktop and Start-menu shortcuts point to ${exe}`);
}

// Language of the desktop screens and menus: chosen by the user, else the Windows display language (Hindi / Kannada / English)
const lang = () => config.lang || YI.fromLocale(app.getLocale());
const T = (k, v) => YI.t(lang(), k, v);

// Read once. A file saved with a byte-order mark (Windows PowerShell does that) is accepted, and a file that cannot be
// read is written to the log instead of silently leaving the app without download address and release key.
let distCache = null;
function distribution() {
  if (distCache) return distCache;
  const file = path.join(ROOT, 'distribution.json');
  try {
    distCache = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch (e) {
    distCache = {};
    if (e && e.code !== 'ENOENT') log(`[setup] ERROR: distribution.json could not be read (${e.message}) — no download address, no release key`);
  }
  return distCache;
}
const releaseKey = () => distribution().publicKey || null;
/**
 * Fail closed: the installed app only downloads releases it can check with the publisher's key. A build without that key
 * (damaged distribution.json) refuses to download anything instead of silently installing unsigned files.
 * Returns the message for the user, or null when downloads are allowed (a developer run may use unsigned test releases).
 */
function unsignedRefusal(what) {
  if (!app.isPackaged || releaseKey()) return null;
  log(`[setup] ${what} refused: this copy of Yukti has no release key, so the download cannot be checked`);
  return T('main.unsigned');
}
// every download goes through Chromium's network stack: it uses the Windows proxy settings (incl. PAC) and the Windows
// certificate store, which plant networks need. Node's own fetch knows neither.
const netFetch = (url, init) => electronNet.fetch(url, init);

app.setAppUserModelId('in.uniminds.yukti');
// nothing may fail silently: unexpected errors in the main process are written to the log instead of vanishing
process.on('uncaughtException', (e) => { try { log(`[error] ${e && e.stack || e}`); } catch { /* logging not ready */ } });
process.on('unhandledRejection', (e) => { try { log(`[error] unhandled: ${e && e.stack || e}`); } catch { /* logging not ready */ } });
app.on('child-process-gone', (_e, d) => { try { log(`[window] helper process ${d.type} stopped (${d.reason})`); } catch { /* ignore */ } });
// Keep Chromium quiet on the network: no component updates / background pings.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
// lets the Yukti page know it runs inside this app (it then offers "Add" buttons that open the desktop add-on screen)
app.userAgentFallback = `${app.userAgentFallback} YuktiDesktop/${app.getVersion()}`;

let config = { ...DEFAULTS };
let win = null, tray = null;
let page = null;              // 'setup' | 'splash' | 'features' | 'app'
let server = null;            // { proc, exited, root, port, url, stopping } when we own the local server
let attached = false;         // local mode, but the running server was NOT started by this app (found by the health probe)
let activeUrl = null;         // origin of the Yukti app currently (or last) shown in the window
let quitting = false;
let autoRestarts = [];      // times the local server was restarted after stopping unexpectedly
let installAbort = null;
let startingUp = true;        // until the first window exists (a second double-click must not open the setup page meanwhile)
let hiddenByUser = false;     // the user closed the window to the tray: nothing but the user brings it back
let secureOrigin = '';        // the plain-http plant server whose page was made "secure" at launch (microphone)
let bootSeq = 0;              // bumps whenever a start-up sequence is superseded
let lastStatus = null;        // last startup status (replayed when the startup page (re)loads)
let setupNotice = null;       // message shown once on the setup page (e.g. "server unreachable")
const logBuf = [];
let logFile = null;

// ------------------------------------------------------------ config
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { config = { ...DEFAULTS }; }
}
function saveConfig() {
  try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(config, null, 2)); } catch (e) { console.error('config save failed', e); }
}
function normUrl(u) {
  let s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return new URL(s).origin;
}
const manifestUrl = () => config.manifestUrl || distribution().manifestUrl || '';

// The microphone only works on a secure page. A plant server on the LAN is usually plain http, so that one saved origin
// (and nothing else) is treated as secure. Chromium switches must be set before the app is ready.
try {
  const saved = JSON.parse(fs.readFileSync(cfgPath(), 'utf8'));
  const o = saved.mode === 'remote' && saved.serverUrl ? normUrl(saved.serverUrl) : '';
  if (needsSecureSwitch(o)) {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', o);
    secureOrigin = o;
  }
} catch { /* first start: no saved server yet */ }
// plain http on the plant network (this computer itself always counts as secure)
function needsSecureSwitch(o) {
  return String(o || '').startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(o);
}

// ------------------------------------------------------------ health
async function health(base, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store', headers: { 'X-Lang': lang() } });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    if (!j || j.ok !== true) return { ok: false, error: T('main.health.notYukti') };
    return { ok: true, version: j.version, engine: j.engine, instance: j.instance || null, raw: j };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? T('main.health.timeout') : (e.cause && e.cause.code) || e.message };
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------ logs
const desktopLogDir = () => path.join(app.getPath('userData'), 'logs');
function openLogFile() {
  try {
    const dir = desktopLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'desktop.log');
    if (fs.existsSync(f)) fs.renameSync(f, path.join(dir, 'desktop.prev.log'));
    logFile = fs.createWriteStream(f, { flags: 'w' });
  } catch { logFile = null; }
}
function log(line) {
  const s = String(line).replace(/\r?\n$/, '');
  if (!s) return;
  logBuf.push(s);
  if (logBuf.length > 2000) logBuf.splice(0, logBuf.length - 2000);
  if (logFile) logFile.write(`${new Date().toISOString()} ${s}\n`);
  // problems also go to errors.log next to desktop.log, so they can be found at once
  if (/\[error\]|\bfail(ed|s)?\b|could not|cannot|not responding|stopped|refused|timed out|mismatch|invalid/i.test(s)) appendError(`${new Date().toISOString()} ${s}\n`);
  try { sendUi('splash', 'splash:log', s); } catch { /* window not ready */ }
}
// errors.log is kept across starts, so it must not grow for ever: at 1 MB it becomes errors.prev.log (replacing the older
// one) and a new file is started — together never more than about 2 MB
const ERR_LOG_MAX = 1024 * 1024;
let errLogBytes = -1;   // size of errors.log (-1 = not looked at yet)
function appendError(text) {
  try {
    const f = path.join(desktopLogDir(), 'errors.log');
    if (errLogBytes < 0) { try { errLogBytes = fs.statSync(f).size; } catch { errLogBytes = 0; } }
    if (errLogBytes >= ERR_LOG_MAX) {
      try { fs.renameSync(f, path.join(desktopLogDir(), 'errors.prev.log')); } catch { try { fs.truncateSync(f, 0); } catch { /* keep appending */ } }
      errLogBytes = 0;
    }
    fs.appendFileSync(f, text);
    errLogBytes += Buffer.byteLength(text);
  } catch { /* logs folder not ready */ }
}
function serverLogDir(root = config.installRoot) {
  // packaged servers keep data in %LOCALAPPDATA%\Yukti\data (older installs: <install>\data\store)
  const legacy = path.join(root || '', 'data', 'store', 'logs');
  if (root && fs.existsSync(path.join(root, 'data', 'store', 'yukti.db'))) return fs.existsSync(legacy) ? legacy : null;
  const appdata = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Yukti', 'data', 'logs');
  return fs.existsSync(appdata) ? appdata : (root && fs.existsSync(legacy) ? legacy : null);
}
// same fingerprint as the server's /api/health "instance" (sha256 of the lower-cased install folder)
function instanceId(root) {
  return require('crypto').createHash('sha256').update(path.resolve(root || '').toLowerCase()).digest('hex').slice(0, 12);
}
function openLogs(which) {
  const dir = (which !== 'desktop' && serverLogDir()) || desktopLogDir();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
}

// send to the window only while it shows the given local page
function sendUi(pg, ch, data) {
  if (!win || win.isDestroyed() || page !== pg) return;
  if (!win.webContents.getURL().startsWith('file://')) return;
  win.webContents.send(ch, data);
}
function setStatus(s) {
  lastStatus = { ...s, url: server ? server.url : config.serverUrl };
  sendUi('splash', 'splash:status', lastStatus);
}

// ------------------------------------------------------------ ports
function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(true)));
  });
}
function canConnect(port) {
  return new Promise((resolve) => {
    const c = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { clearTimeout(t); c.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), 400);
    c.once('connect', () => done(true));
    c.once('error', () => done(false));
  });
}
async function portFree(port) { return (await canBind(port)) && !(await canConnect(port)); }
const validPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;
async function firstFreePort() {
  for (let p = PORT_RANGE[0]; p <= PORT_RANGE[1]; p++) if (await portFree(p)) return p;
  return null;
}

// ------------------------------------------------------------ local server
function serverKind(root) {
  if (!root) return null;
  if (fs.existsSync(path.join(root, 'yukti-server.exe'))) return 'bundle';          // shipped, self-contained package
  if (fs.existsSync(path.join(root, 'backend', 'app', 'main.py'))) return 'dev';     // developer checkout (uv)
  return null;
}
const serverAlive = () => !!(server && !server.exited);

function startLocalServer(installRoot, port) {
  const kind = serverKind(installRoot);
  if (!kind) throw new Error(T('main.noServerAt', { root: installRoot }));
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  let proc;
  if (kind === 'bundle') {
    const exe = path.join(installRoot, 'yukti-server.exe');
    // --parent-pid: the server exits by itself if this app disappears (crash / task kill)
    const args = ['--host', '127.0.0.1', '--port', String(port), '--parent-pid', String(process.pid)];
    log(`> ${exe} ${args.join(' ')}`);
    proc = spawn(exe, args, { cwd: installRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    const backend = path.join(installRoot, 'backend');
    env.UV_CACHE_DIR = process.env.UV_CACHE_DIR || 'E:/uvcache';
    const args = ['run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)];
    log(`> uv ${args.join(' ')}   (cwd ${backend})`);
    proc = spawn('uv', args, { cwd: backend, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const me = { proc, exited: false, root: installRoot, port, url: localUrl(port) };
  server = me;
  const pipe = (stream) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => { rest += d; const lines = rest.split(/\r?\n/); rest = lines.pop(); lines.forEach(log); });
    stream.on('end', () => rest && log(rest));
  };
  pipe(proc.stdout); pipe(proc.stderr);
  proc.on('error', (e) => { log(`[yukti-desktop] failed to start the Yukti server: ${e.message}`); me.exited = true; me.error = e.message; });
  proc.on('exit', (code, sig) => {
    log(`[yukti-desktop] server exited (code ${code}${sig ? ', ' + sig : ''})`);
    me.exited = true;
    // exit code 75 = the server asked to be restarted (e.g. Admin > Backup > Restart now after staging a restore)
    if (code === 75 && !quitting && !me.stopping && server === me) {
      log('[yukti-desktop] server requested a restart');
      bootSeq++;
      showSplash();
      setTimeout(bootLocal, 500);
      updateTray();
      return;
    }
    if (me.error == null && code) me.error = T('main.exitCode', { code });
    // stopped unexpectedly while the user works in the app → show the startup page with the error panel
    if (!quitting && !me.stopping && server === me && page === 'app' && activeUrl === me.url) {
      bootSeq++;
      // restart it by itself (twice in 10 minutes at most); only a repeated failure is shown to the user
      const now = Date.now();
      autoRestarts = autoRestarts.filter((t) => now - t < 10 * 60 * 1000);
      if (autoRestarts.length < 2) {
        autoRestarts.push(now);
        log('[yukti-desktop] the server stopped unexpectedly — restarting it');
        showSplash();
        setTimeout(bootLocal, 1000);
      } else {
        showSplash();
        failStart(T('main.stopped'));
      }
    }
    updateTray();
  });
  return me;
}

function taskkill(pid, force) {
  return new Promise((resolve) => {
    const a = ['/PID', String(pid), '/T']; if (force) a.push('/F');
    execFile('taskkill', a, { windowsHide: true }, () => resolve());
  });
}
function waitExit(proc, ms) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    proc.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}
// Stops the server this app started. Overlapping callers (quit while an update stops it, Retry clicked twice…) share ONE
// stop; and only the server that was stopped is forgotten — a new one started meanwhile is never dropped by mistake.
function stopLocalServer() {
  const me = server;
  if (!me || me.exited || !me.proc.pid) { if (server === me) server = null; return Promise.resolve(); }
  if (me.stopping) return me.stopping;
  me.stopping = (async () => {
    const { proc } = me;
    log('[yukti-desktop] stopping local server…');
    // 1) polite: taskkill without /F (WM_CLOSE / CTRL-signal to the tree)
    await taskkill(proc.pid, false);
    let done = await waitExit(proc, 4000);
    // 2) fallback: force-kill the whole tree (uv → python → llama-server)
    if (!done) { await taskkill(proc.pid, true); done = await waitExit(proc, 4000); }
    if (server === me) server = null;
    updateTray();
  })();
  return me.stopping;
}

// ------------------------------------------------------------ start-up sequence (startup page)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootLocal() {
  const seq = ++bootSeq;
  const live = () => seq === bootSeq && !quitting;
  lastStatus = null;
  showSplash();
  setStatus({ step: 'check', text: T('main.checking'), secs: 0 });
  let base = null;
  attached = false;
  // ours, still running (never one that is being stopped right now: it would be gone a moment later)
  if (serverAlive() && !server.stopping && server.root === config.installRoot) base = server.url;
  else {
    if (serverAlive()) await stopLocalServer();                                   // ours, but another folder (or mid-stop)
    if (!live()) return;
    for (const port of [...new Set([DEFAULT_PORT, config.localPort].filter(validPort))]) {
      const h = await health(localUrl(port), 1500);
      if (!h.ok) continue;
      // only reuse a server started from THIS install folder (not an older version or another copy). A server that does
      // not say which folder it runs from is not adopted either: it could be anything.
      if (h.instance !== instanceId(config.installRoot)) {
        log(`[yukti-desktop] a different Yukti installation is running on ${localUrl(port)} — starting this one on another port.`);
        continue;
      }
      // not started by this app (e.g. the "Yukti Server" window): it is used, but this app can neither stop nor restart it
      base = localUrl(port); attached = true; log(`[yukti-desktop] Yukti ${h.version} already serving on ${base} — connecting.`); break;
    }
  }
  if (!live()) return;
  if (!base) {
    // the port of the last run first, so the address of Yukti (and what the page stored under it, e.g. the chosen
    // language) stays the same between runs; then the usual port, then the first free one of the range
    let port = null;
    for (const p of [...new Set([config.localPort, DEFAULT_PORT].filter(validPort))]) {
      if (await portFree(p)) { port = p; break; }   // busy also when another Yukti installation holds it
    }
    if (!port) {
      port = await firstFreePort();
      if (!port) return failStart(T('main.portBusy', { a: PORT_RANGE[0], b: PORT_RANGE[1] }));
      log(`[yukti-desktop] port ${DEFAULT_PORT} is used by another program — starting Yukti on port ${port} instead.`);
    }
    if (!live()) return;
    try { startLocalServer(config.installRoot, port); } catch (e) { return failStart(e.message); }
    base = server.url;
  }
  config.localPort = Number(new URL(base).port) || DEFAULT_PORT;
  config.serverUrl = base;
  saveConfig();
  return waitReadyThenOpen(base, live);
}

async function waitReadyThenOpen(base, live) {
  const t0 = Date.now();
  const firstRun = !config.startedOnce;
  const limit = firstRun ? FIRST_RUN_TIMEOUT_MS : READY_TIMEOUT_MS;
  const own = !attached && server && server.url === base ? server : null;
  let upSince = null;
  let failSince = null;   // a server we did not start: since when it stopped answering
  let h = { ok: false };
  while (live()) {
    if (own && own.exited) return failStart(own.error || T('main.exited'));
    h = await health(base, 2500);
    if (!live()) return;
    // A server this app did not start gives no "exited" signal. When it answered and then stops answering (two checks in
    // a row, so one slow answer is not mistaken for it), or does not answer for about 10 s, it is gone: start Yukti
    // ourselves instead of showing "starting" for minutes.
    if (!own) {
      if (h.ok) failSince = null;
      else {
        failSince = failSince || Date.now();
        // "gone" means nothing listens on its port any more. A server that is only slow (busy loading the AI model) still
        // holds the port: starting a second Yukti on the same data folder next to it must never happen.
        const port = Number(new URL(base).port) || DEFAULT_PORT;
        if (Date.now() - failSince > (upSince ? 3000 : 10000) && (await portFree(port))) {
          log(`[yukti-desktop] the Yukti server on ${base} (not started by this app) no longer answers — starting Yukti here.`);
          attached = false;
          return bootLocal();
        }
      }
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    setStatus({ step: 'wait', secs, firstRun, limitSecs: limit / 1000, up: h.ok, health: h.ok ? h.raw : null, error: null, reachError: h.ok ? null : h.error });
    if (h.ok) {
      upSince = upSince || Date.now();
      const j = h.raw || {};
      if (j.engine === 'error') {
        log(`[yukti-desktop] AI engine reported an error${j.error ? ': ' + j.error : ''} — opening Yukti anyway.`);
        setStatus({ ...lastStatus, notice: T('main.modelNotice') });
        await sleep(2000);
        if (live() && page === 'splash') openApp(base, true);   // never pull the user away from another page
        return;
      }
      const legacyReady = j.ready === undefined && (j.engine === 'ready' || (j.engine === 'idle' && Date.now() - upSince > 15000));
      if (j.ready === true || legacyReady) {
        setStatus({ ...lastStatus, done: true });
        await sleep(350);
        if (live() && page === 'splash') openApp(base, true);
        return;
      }
    }
    if (Date.now() - t0 > limit) {
      return failStart(T('main.notReady', { n: Math.round(limit / 60000) }), { canOpen: h.ok });
    }
    await sleep(1000);
  }
}

function failStart(msg, extra = {}) {
  log(`[yukti-desktop] ERROR: ${msg}`);
  setStatus({ ...(lastStatus || {}), step: 'failed', failed: true, error: msg, tail: logBuf.slice(-30), notice: null, ...extra });
}

// ------------------------------------------------------------ the window
function winIcon() { return nativeImage.createFromPath(ICON_PNG); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Saved window position only if it is still (mostly) on a connected screen — else Windows would open Yukti off-screen
 *  (e.g. last used on a second monitor): it would sit in the taskbar but never appear. */
function visibleBounds(b) {
  if (!b || b.x == null || b.y == null) return {};
  try {
    const onScreen = screen.getAllDisplays().some(({ workArea: w }) =>
      b.x + 100 > w.x && b.y + 40 > w.y && b.x + 100 < w.x + w.width && b.y + 40 < w.y + w.height);
    return onScreen ? { x: b.x, y: b.y } : {};
  } catch { return {}; }
}
function ensureOnScreen() {
  if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
  if (!('x' in visibleBounds(win.getBounds()))) win.center();   // x can be 0 (snapped to the left edge): test presence, not value
}

function createWindow() {
  const b = config.bounds || {};
  const wa = (() => { try { return screen.getPrimaryDisplay().workAreaSize; } catch { return { width: 1440, height: 900 }; } })();
  // small laptop screens (1366×768 leaves about 728 px): the minimum height must fit on the screen, or the bottom of
  // the window (buttons) can never be reached
  const minH = Math.min(760, wa.height);
  startingUp = false;
  win = new BrowserWindow({
    // never larger than the screen (small laptop screens), at least the minimum Yukti needs
    width: Math.min(Math.max(1200, b.width || 1440), Math.max(1200, wa.width)), height: Math.min(Math.max(minH, b.height || 900), Math.max(minH, wa.height)),
    ...visibleBounds(b), minWidth: 1200, minHeight: minH, title: 'Yukti', icon: winIcon(), show: false,
    backgroundColor: BG, autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),   // exposes window.yukti on file:// pages only
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: DEBUG,
    },
  });
  if (b.maximized) win.maximize();
  const persist = () => {
    if (!win || win.isDestroyed()) return;
    config.bounds = { ...(win.isMaximized() || win.isFullScreen() ? (config.bounds || {}) : win.getBounds()), maximized: win.isMaximized() };
    saveConfig();
  };
  win.on('resize', debounce(persist, 500));
  win.on('move', debounce(persist, 500));
  win.on('close', (e) => {
    persist();
    // keep running in the tray while Yukti is in use / a local server runs; otherwise closing quits
    if (!quitting && tray && (page === 'app' || serverAlive())) {
      e.preventDefault(); win.hide();
      hiddenByUser = true;
      trayHint();
    }
    else if (!quitting) quitApp();
  });
  win.on('closed', () => { win = null; });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('Yukti'); });
  win.once('ready-to-show', () => { if (!hiddenByUser) { win.show(); ensureOnScreen(); } });
  // a page that fails before its first paint never sends ready-to-show: show the window anyway
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible() && !hiddenByUser) { win.show(); ensureOnScreen(); } }, 4000);
  // the page crashed or hung: log it and bring Yukti back instead of leaving a blank window — but not for ever: a page
  // that keeps stopping is not reloaded again and again (3 times a minute at most), the start-up page then says so
  let recoveries = [], gaveUp = false;
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`[window] page stopped (${d.reason}, exit ${d.exitCode})`);
    if (d.reason === 'clean-exit' || quitting) return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const now = Date.now();
      recoveries = recoveries.filter((t) => now - t < 60000);
      if (!recoveries.length) gaveUp = false;
      if (recoveries.length >= 3) {
        if (gaveUp) return;   // even the start-up page does not stay up: leave it, the tray menu still works
        gaveUp = true;
        log('[window] the page stopped 3 times within a minute — not reloading it again');
        bootSeq++;
        showSplash();
        failStart(T('main.pageKeepsStopping'));
        return;
      }
      recoveries.push(now);
      if (page === 'app' && activeUrl) openApp(activeUrl); else win.webContents.reload();
    }, 500);
  });
  let hangTimer = null;
  win.on('unresponsive', () => {
    log('[window] page not responding');
    clearTimeout(hangTimer);
    // a full minute: a slow computer that is loading the AI model can freeze the page for a while and then recover
    hangTimer = setTimeout(() => { if (win && !win.isDestroyed()) { log('[window] still not responding — reloading'); win.webContents.forcefullyCrashRenderer(); } }, 60000);
  });
  win.on('responsive', () => { clearTimeout(hangTimer); });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && page === 'app') {
      dialog.showMessageBox(win, { type: 'error', title: 'Yukti', message: T('main.loadFailed', { url }), detail: T('main.loadFailedDetail', { desc, code }) });
    }
  });
  lockDown(win.webContents);
  buildMenu();
}

function ensureWin() {
  if (!win || win.isDestroyed()) createWindow();
  return win;
}
function showWin() {
  if (!win || win.isDestroyed()) return;
  // closed to the tray by the user: a restart of Yukti in the background must not pop the window up again
  if (hiddenByUser) return;
  if (!win.isVisible() && win.webContents.getURL()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
// loadFile / loadURL return a promise that is rejected when the page is replaced by the next one before it finished
// loading (ERR_ABORTED): that is normal here and must not end up in the error log; real failures are logged
function loaded(p) {
  p.catch((e) => {
    const m = String((e && e.message) || e);
    if (!/ERR_ABORTED|\(-3\)/.test(m)) log(`[window] the page could not be loaded: ${m}`);
  });
}

function showSetup(notice) {
  if (notice) setupNotice = notice;
  page = 'setup';
  loaded(ensureWin().loadFile(UI('connect.html')));
  win.setProgressBar(-1);
  showWin();
  buildMenu();
}
function showFeatures(add) {
  bootSeq++;   // a start-up sequence that is still waiting must not open Yukti over this page
  page = 'features';
  loaded(ensureWin().loadFile(UI('features.html'), { query: { add: ['vision', 'voice'].includes(add) ? add : '' } }));
  win.setProgressBar(-1);
  showWin();
  buildMenu();
}
function showSplash() {
  page = 'splash';
  loaded(ensureWin().loadFile(UI('splash.html')));
  win.setProgressBar(-1);
  showWin();
  buildMenu();
}
function openApp(base, saveOk) {
  if (saveOk && !config.startedOnce) { config.startedOnce = true; saveConfig(); }
  activeUrl = base;
  page = 'app';
  const syncLang = config.webLang !== lang();
  if (syncLang) { config.webLang = lang(); saveConfig(); }
  loaded(ensureWin().loadURL(base + (syncLang ? `/?lang=${lang()}` : '/')));
  showWin();
  buildMenu();
  ensureTray();
}

// ------------------------------------------------------------ security
function isHttp(u) { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } }
function sameOrigin(u, base) { try { return !!base && new URL(u).origin === new URL(base).origin; } catch { return false; } }

const locked = new WeakSet();
function lockDown(wc) {
  if (locked.has(wc)) return;
  locked.add(wc);
  // Page switches are done by the main process (loadFile/loadURL → no will-navigate). Renderer-initiated navigation is
  // only allowed inside the Yukti app's own origin; nothing may navigate into file://.
  const allowed = (u) => page === 'app' && isHttp(u) && sameOrigin(u, activeUrl);
  // <server>/desktop/features?add=vision|voice from the Yukti page opens the desktop's own add-on screen (file://);
  // the page itself never gets access to the installer
  const featureLink = (u) => {
    if (!allowed(u)) return null;
    const x = new URL(u);
    return x.pathname === '/desktop/features' ? (x.searchParams.get('add') || '') : null;
  };
  wc.on('will-navigate', (e, url) => {
    const add = featureLink(url);
    if (add !== null) { e.preventDefault(); showFeatures(add); return; }
    if (allowed(url)) return;
    e.preventDefault();
    if (isHttp(url)) shell.openExternal(url); // user-clicked link to another host (e.g. a source citation)
    else if (/^mailto:/i.test(url)) shell.openExternal(url); // e.g. Help > Report a problem
  });
  wc.on('will-redirect', (e, url) => { if (isHttp(url) && page === 'app' && !sameOrigin(url, activeUrl)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    const add = featureLink(url);
    if (add !== null) { showFeatures(add); return { action: 'deny' }; }
    if (allowed(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: winIcon(), autoHideMenuBar: true, backgroundColor: BG,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (isHttp(url) || /^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => lockDown(child.webContents));
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

function setupSession() {
  const ses = session.defaultSession;
  // deny powerful permissions except clipboard write / notifications / the microphone (voice input; never the camera)
  // from the configured server
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const mic = perm === 'media' && (details.mediaTypes || []).length > 0 && details.mediaTypes.every((t) => t === 'audio');
    const ok = (mic || ['clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(perm)) &&
      sameOrigin(details.requestingUrl || wc.getURL(), activeUrl);
    cb(ok);
  });
  ses.on('will-download', (_e, item) => {
    const def = path.join(app.getPath('downloads'), item.getFilename());
    const parent = BrowserWindow.getFocusedWindow() || win;
    const target = dialog.showSaveDialogSync(parent, { title: T('main.saveFile'), defaultPath: def });
    if (!target) { item.cancel(); return; }
    item.setSavePath(target);
    item.once('done', (_ev, state) => {
      if (parent && !parent.isDestroyed()) parent.setProgressBar(-1);
      if (state !== 'completed' && state !== 'cancelled') {
        dialog.showMessageBox(parent, { type: 'error', title: T('main.downloadFailed'), message: `${T('main.downloadFailed')}: ${path.basename(target)}` });
      }
    });
    item.on('updated', () => {
      const tot = item.getTotalBytes();
      if (parent && !parent.isDestroyed() && tot > 0) parent.setProgressBar(item.getReceivedBytes() / tot);
    });
  });
}

// ------------------------------------------------------------ menu / tray / about
function modeLabel() { return config.mode === 'local' ? T('about.mode.local') : config.mode === 'remote' ? T('about.mode.remote') : T('about.mode.none'); }

/** Opens the email app with a problem report (context + recent desktop log); also saves the full report as a file. */
function reportProblem(context) {
  const lines = logBuf.slice(-60).join('\n');
  const body = [`Yukti ${app.getVersion()} · Windows ${require('os').release()} · ${lang()}`, '', 'What went wrong:', context || '-', '',
    '--- recent log ---', lines].join('\n');
  const file = path.join(app.getPath('downloads'), `yukti-problem-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`);
  try { fs.writeFileSync(file, body, 'utf8'); } catch { /* downloads folder not writable */ }
  let short = body.length > 1600 ? body.slice(0, 1600) + `\n…\n(full report: ${file})` : body;
  shell.openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Yukti ${app.getVersion()}] ${T('main.reportSubject')}`)}&body=${encodeURIComponent(short)}`);
}
function reportFromMenu() {
  // inside Yukti the guided report dialog of the web app is used; elsewhere (setup / start-up) the desktop report
  if (page === 'app' && win && !win.isDestroyed()) win.webContents.executeJavaScript("location.hash = 'report-problem'").catch(() => reportProblem(''));
  else reportProblem(lastStatus && lastStatus.error ? lastStatus.error : '');
}
function setLanguage(l) {
  if (!YI.LANGS.includes(l)) return;
  config.lang = l; saveConfig();
  buildMenu(); updateTray();
  if (page === 'app' && win && !win.isDestroyed()) {   // switch the open Yukti page too
    config.webLang = l; saveConfig();
    win.webContents.executeJavaScript(`try { localStorage.setItem('yukti.lang', '${l}'); } catch (e) {} location.reload();`).catch(() => {});
  } else if ((page === 'setup' || page === 'features') && win && !win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
    // these pages change their texts in place: a reload would lose the progress of a running download
    win.webContents.send('ui:lang', l);
  } else if (win && !win.isDestroyed()) win.webContents.reload();
}

function about() {
  const owns = serverAlive() ? ` — ${T('about.owns', { port: server.port })}` : '';
  dialog.showMessageBox(win || undefined, {
    type: 'info', title: T('menu.about'), icon: winIcon(),
    message: `Yukti ${app.getVersion()}`,
    detail: [T('setup.sub'), '', T('about.server', { url: activeUrl || T('about.none') }), `${T('about.mode', { mode: modeLabel() })}${owns}`, '',
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`, T('about.offline'), '',
      T('about.report', { email: SUPPORT_EMAIL })].join('\n'),
  });
}

// a download / removal is running: the pages that could start another one, or leave the one that shows it, are closed
const busyChanging = () => !!installAbort || !!removing;

function buildMenu() {
  const tpl = [
    { label: T('menu.file'), submenu: [
      { label: T('menu.switch'), accelerator: 'CmdOrCtrl+Shift+S', enabled: page !== 'setup' && !busyChanging(), click: () => { bootSeq++; showSetup(); } },
      // only from inside Yukti: while it is still starting, the start-up sequence owns the window
      { label: T('menu.addons'), enabled: page === 'app' && !busyChanging(), click: () => showFeatures('') },
      { label: T('menu.reload'), accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
      { type: 'separator' },
      { label: T('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => quitApp() },
    ] },
    { label: T('menu.edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: T('menu.language'), submenu: YI.LANGS.map((l) => ({ label: YI.t(l, 'lang.name'), type: 'radio', checked: lang() === l, click: () => setLanguage(l) })) },
    { label: T('menu.view'), submenu: [
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(DEBUG ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
    ] },
    { label: T('menu.help'), submenu: [
      { label: T('menu.report'), click: reportFromMenu },
      { label: T('menu.logs'), click: () => openLogs() },
      { type: 'separator' }, { label: T('menu.about'), click: about }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function ensureTray() {
  if (tray) return updateTray();
  tray = new Tray(nativeImage.createFromPath(TRAY_PNG));
  tray.setToolTip('Yukti');
  tray.on('click', showMainWin);          // one click opens Yukti (most people never double-click a tray icon)
  tray.on('double-click', showMainWin);
  updateTray();
}
function showMainWin() {
  hiddenByUser = false;   // the user asks for the window (tray icon, tray menu, second double-click on the Yukti icon)
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show(); ensureOnScreen();
    // Windows may refuse to bring a background app to the front: briefly keep it on top so it really appears
    win.setAlwaysOnTop(true); win.focus(); setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 300);
  }
  else if (startingUp) return;   // still deciding which page to open: the window appears by itself in a moment
  else if (page === 'app' && activeUrl) openApp(activeUrl);
  else showSetup();
}
// The first time the window is closed to the tray, say so once — otherwise people think Yukti was closed (or never find
// out how to quit it).
function trayHint() {
  if (config.trayHintShown || !tray || process.platform !== 'win32') return;
  try {
    tray.displayBalloon({ title: 'Yukti', content: T('main.trayHint'), icon: winIcon(), iconType: 'custom' });
    config.trayHintShown = true; saveConfig();
  } catch (e) { log(`[tray] hint not shown: ${e.message}`); }
}
async function serverStatus() {
  const base = activeUrl || config.serverUrl;
  const h = await health(base, 4000);
  const j = h.raw || {};
  const lines = [T('status.server', { url: base })];
  if (h.ok) {
    lines.push(T('status.version', { v: h.version }), T('status.engine', { e: h.engine }));
    if (j.stage) lines.push(T('status.stage', { s: j.stage }));
  } else lines.push(T('status.unreachable', { err: h.error }));
  lines.push(T('about.mode', { mode: modeLabel() }));
  dialog.showMessageBox({ type: h.ok ? 'info' : 'warning', title: T('main.statusTitle'), message: h.ok ? T('main.online') : T('main.offline'), detail: lines.join('\n'), icon: winIcon() });
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: T('menu.open'), click: showMainWin },
    { label: T('menu.status'), click: serverStatus },
    { type: 'separator' },
    { label: T('menu.quit'), click: () => quitApp() },
  ]));
}

function quitApp() { quitting = true; app.quit(); }

// ------------------------------------------------------------ IPC (local pages only)
// Every handler verifies that the call comes from a local file:// page of the main window — never from the
// remote Yukti web app (which additionally has no window.yukti bridge at all, see preload.js).
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    const url = (e.senderFrame && e.senderFrame.url) || '';
    if (!url.startsWith('file://') || !win || win.isDestroyed() || e.sender !== win.webContents) {
      throw new Error(`IPC ${channel} rejected: not a local Yukti page`);
    }
    return fn(e, ...args);
  });
}

function defaultMode() {
  if (config.mode === 'remote') return 'remote';
  if (bundledServer() && (!config.mode || config.installRoot === bundledServer())) return 'local';
  if (config.mode === 'local') return fs.existsSync(path.join(config.installRoot || '', 'installed.json')) ? 'install' : 'local';
  return distribution().manifestUrl ? 'install' : 'remote';   // first run
}

handle('yukti:getConfig', () => {
  const notice = setupNotice; setupNotice = null;
  const canGoBack = !!activeUrl && (config.mode === 'remote' || serverAlive());
  return {
    mode: config.mode, defaultMode: defaultMode(), serverUrl: config.serverUrl,
    installRoot: config.mode === 'local' && serverKind(config.installRoot) ? config.installRoot : (bundledServer() || config.installRoot),
    bundled: bundledServer(),
    dest: config.mode === 'local' && config.installRoot && fs.existsSync(path.join(config.installRoot, 'installed.json')) ? config.installRoot : DEFAULT_DEST,
    manifestUrl: manifestUrl(), version: app.getVersion(), connected: activeUrl, canGoBack, notice, lang: lang(),
    serverRunning: serverAlive() ? server.url : null,
    // a download keeps running when the page is reloaded: the page then shows it again instead of starting a second one
    installing: !!installAbort && !featureBusy, installFeature: featureBusy, lastInstall,
  };
});
handle('yukti:test', async (_e, url) => {
  let base; try { base = normUrl(url); } catch { return { ok: false, error: T('main.badUrl') }; }
  return { base, ...(await health(base, 5000)), raw: undefined };
});
handle('yukti:browseRoot', async () => {
  const r = await dialog.showOpenDialog(win || undefined, { title: T('main.selectFolder'), properties: ['openDirectory', 'createDirectory'], defaultPath: config.installRoot });
  return r.canceled ? null : r.filePaths[0];
});
handle('yukti:back', () => {
  if (activeUrl && (config.mode === 'remote' || serverAlive())) { openApp(activeUrl); return true; }
  return false;
});
handle('yukti:openLogs', (_e, which) => { openLogs(which); return true; });
handle('yukti:connect', async (_e, req) => {
  if (req.mode === 'remote') {
    let base; try { base = normUrl(req.serverUrl); } catch { return { ok: false, error: T('main.badUrl') }; }
    const h = await health(base, 5000);
    if (!h.ok) return { ok: false, error: T('main.cannotReach', { base, err: h.error }) };
    if (serverAlive() && server.url !== base) await stopLocalServer();     // switching away from all-in-one mode
    config.mode = 'remote'; config.serverUrl = base; saveConfig();
    attached = false;
    bootSeq++;
    // The microphone needs a "secure" page, and for a plain-http plant server that is a start-up switch of the browser
    // engine (see above): it only takes effect after a restart. So a NEW such server restarts the app once, by itself.
    if (needsSecureSwitch(base) && base !== secureOrigin) {
      log(`[setup] new plant server ${base}: restarting the app once so that the microphone works there`);
      setTimeout(() => { app.relaunch(); quitApp(); }, 1800);   // long enough to read the notice
      return { ok: true, notice: T('main.relaunch') };
    }
    setImmediate(() => openApp(base));
    return { ok: true };
  }
  if (req.mode === 'local') {
    const root = String(req.installRoot || '').trim();
    if (!serverKind(root)) return { ok: false, error: T('main.noServerAt', { root }) };
    if (config.installRoot !== root) config.startedOnce = false;
    config.mode = 'local'; config.installRoot = root;
    // "Later" on an offered update: the offer is remembered only now (not when it was merely shown), so closing the
    // window or a crash does not make it disappear for good
    if (req.later) config.updateOffered = app.getVersion();
    saveConfig();
    setImmediate(bootLocal);
    return { ok: true };
  }
  return { ok: false, error: T('main.unknownMode') };
});

// NVIDIA graphics card on this computer? Asked once — but a check that FAILED is not remembered (it is asked again next
// time), and until then the universal engine is assumed.
let gpuPromise = null;
function nvidiaGpu() {
  gpuPromise = gpuPromise || installer.detectNvidiaGpu().then((r) => {
    if (r !== null) return r;
    gpuPromise = null;
    log('[setup] the graphics card check failed — assuming no NVIDIA card for now');
    return false;
  });
  return gpuPromise;
}
// options every call into the installer shares: release key, graphics card, and Chromium's network stack for downloads
async function installerOpts(url, dest) {
  return { manifestUrl: url, publicKey: releaseKey(), dest, forceGpu: await nvidiaGpu(), fetch: netFetch };
}
/**
 * Is a Yukti server running from this install folder that this app did NOT start (e.g. the "Yukti Server" window)?
 * Its files are in use and this app can neither stop nor restart it, so nothing may be installed, updated or removed
 * until the user closes it.
 */
async function startedOutside(root) {
  const id = instanceId(root);
  for (const port of [...new Set([config.localPort, DEFAULT_PORT].filter(validPort))]) {
    if (serverAlive() && server.port === port) continue;   // our own
    const h = await health(localUrl(port), 1500);
    if (h.ok && h.instance === id) return true;
  }
  if (path.resolve(root || '').toLowerCase() === path.resolve(config.installRoot || '').toLowerCase()) attached = false;   // it is gone
  return false;
}

let planRefusalLogged = false;
handle('yukti:plan', async (_e, req = {}) => {
  const url = String(req.manifestUrl || '').trim();
  const dest = String(req.dest || '').trim() || DEFAULT_DEST;
  const installed = await installer.installedVersion(dest);
  if (!/^https?:\/\//i.test(url)) return { ok: false, dest, installed, error: null };
  if (app.isPackaged && !releaseKey()) {   // fail closed (see unsignedRefusal); logged once, the page asks repeatedly
    if (!planRefusalLogged) { planRefusalLogged = true; unsignedRefusal('download check'); }
    return { ok: false, dest, installed, error: T('main.unsigned'), plain: true };
  }
  try {
    const p = await installer.plan(await installerOpts(url, dest));
    delete p.manifest;
    return { ok: true, dest, installed, plan: p, updateAvailable: !!(installed && installed.version && installed.version !== p.version) };
  } catch (e) { return { ok: false, dest, installed, error: e.message }; }
});
// ------------------------------------------------------------ add-ons (photos, voice): downloaded later, on request
const FEATURES = ['vision', 'voice'];
const localInstall = () => config.mode === 'local' && config.installRoot && fs.existsSync(path.join(config.installRoot, 'installed.json'));
let featureBusy = null;   // add-on being downloaded right now (the add-on page may be reloaded meanwhile)
let removing = null;      // add-on being removed right now (nothing may be added or installed meanwhile)
let lastFeature = null;   // how the last add / remove ended (for a page that was reloaded and missed the answer)
let lastInstall = null;   // the same for the last install / update on the setup page
// The local server must be (re)started before going back to Yukti: an add-on that needs it, or it was stopped for a
// change. Decided HERE, not by the page — a page can be reloaded and forget.
let featureRestart = false;

/** The message when a change is asked for while another one runs. */
const busyMessage = () => (removing ? T('main.removeRunning') : T('main.installRunning'));
/** Tell the page how a download / removal ended. The same result is also the answer to its call; a reloaded page only
 *  gets it this way (or by asking again, see featuresPlan / getConfig). */
function finished(pg, result) {
  if (pg === 'features') lastFeature = result; else lastInstall = result;
  sendUi(pg, 'install:progress', { phase: 'finished', ...result });
  buildMenu();
  return result;
}
/** Back from the add-ons page to Yukti; the local server is restarted first when a change needs it. */
async function leaveFeatures() {
  const restart = featureRestart;
  featureRestart = false;
  if (config.mode === 'local' && (restart || !serverAlive() || !activeUrl)) {
    if (restart && serverAlive()) await stopLocalServer();
    bootLocal();   // also finds a server that was started outside this app again
  } else if (activeUrl) openApp(activeUrl);
  else showSetup();
}

handle('yukti:featuresPlan', async (_e, req = {}) => {
  // cheap question of a waiting page: "is it still running?" (no internet, no disk access)
  if (req && req.stateOnly) return { ok: true, busy: featureBusy || removing, removing: !!removing, last: lastFeature };
  if (config.mode !== 'local') return { ok: true, local: false, serverUrl: config.serverUrl };
  if (!localInstall()) return { ok: true, local: false, bundled: true };
  const state = { busy: featureBusy || removing, removing: !!removing, last: lastFeature };
  // what is already added is known from this computer alone (and can still be removed) — without internet, and in a
  // build that may not download anything
  const known = async () => { try { return await installer.localFeatures(config.installRoot); } catch { return {}; /* unreadable installed.json */ } };
  if (app.isPackaged && !releaseKey()) return { ok: false, local: true, error: T('main.unsigned'), plain: true, known: await known(), ...state };
  try {
    const p = await installer.plan(await installerOpts(manifestUrl(), config.installRoot));
    return { ok: true, local: true, features: p.features, freeBytes: p.freeBytes, ...state,
      updatePending: !!(p.installed && p.installed.version !== p.version) };
  } catch (e) {
    // no internet / download site down
    return { ok: false, local: true, error: e.message, known: await known(), ...state };
  }
});
handle('yukti:featureInstall', async (_e, feature) => {
  if (!FEATURES.includes(feature) || !localInstall()) return { ok: false, feature, error: T('main.notAvailable'), plain: true };
  if (busyChanging()) return { ok: false, feature, error: busyMessage(), plain: true };
  // busy from the very first moment (before anything is awaited): a second click or a reloaded page sees it at once
  const ctl = installAbort = new AbortController();
  featureBusy = feature;
  buildMenu();
  const dest = config.installRoot;
  const send = (p) => { if (p.message && p.phase !== 'download') log(`[add-on] ${p.message}`); sendUi('features', 'install:progress', { ...p, feature });
    if (p.pct !== undefined && win && !win.isDestroyed()) win.setProgressBar(p.pct / 100); };
  let result;
  try {
    const refusal = unsignedRefusal(`add-on ${feature}`);
    if (refusal) result = { ok: false, feature, error: refusal, plain: true };
    else if (await startedOutside(dest)) {
      log(`[add-on] ${feature} refused: the Yukti server in ${dest} was not started by this app and cannot be stopped by it`);
      result = { ok: false, feature, error: T('main.outside'), plain: true };
    } else {
      const cur = ((await installer.installedVersion(dest)) || {}).features || [];
      const features = [...new Set([...cur, feature])];
      const opts = { ...(await installerOpts(manifestUrl(), dest)), features };
      const pl = await installer.plan(opts);
      // parts of Yukti itself are also out of date (e.g. a newer release): those must not be replaced while it runs
      const core = pl.artifacts.some((a) => a.needed && !a.installed && !a.feature);
      // the photo add-on is used by the AI model only after a restart; the voice add-on is picked up by itself
      const restart = core || feature === 'vision';
      // a newer version of an add-on that is already there replaces files the running server has open (Windows locks them)
      const replacing = !!(pl.features[feature] && pl.features[feature].present);
      if ((core || replacing) && serverAlive()) await stopLocalServer();
      await installer.install({ ...opts, signal: ctl.signal, onProgress: send });
      log(`[add-on] ${feature} installed`);
      if (restart || replacing) featureRestart = true;
      result = { ok: true, feature, restart: featureRestart };
    }
  } catch (e) {
    const cancelled = ctl.signal.aborted;
    log(cancelled ? `[add-on] ${feature} paused` : `[add-on] ${feature} failed: ${e.message}`);
    result = { ok: false, feature, error: e.message, cancelled, stopped: !serverAlive() };
  }
  installAbort = null;
  featureBusy = null;
  if (win && !win.isDestroyed()) win.setProgressBar(-1);
  // the add-on needs a restart of Yukti: done from here after a moment (the page shows "Added. Yukti restarts now…"),
  // unless the user already left the page or started another change
  if (result.ok && result.restart) setTimeout(() => { if (page === 'features' && !busyChanging() && featureRestart) leaveFeatures(); }, 2500);
  return finished('features', result);
});
handle('yukti:featureRemove', async (_e, feature) => {
  if (!FEATURES.includes(feature) || !localInstall()) return { ok: false, feature, removing: true, error: T('main.notAvailable'), plain: true };
  if (busyChanging()) return { ok: false, feature, removing: true, error: busyMessage(), plain: true };   // never delete files a download is writing
  removing = feature;   // held until the files are gone: no download may start in between
  buildMenu();
  let result;
  try {
    if (await startedOutside(config.installRoot)) {
      log(`[add-on] removing ${feature} refused: the Yukti server in ${config.installRoot} was not started by this app`);
      result = { ok: false, feature, removing: true, error: T('main.outside'), plain: true };
    } else {
      if (serverAlive()) await stopLocalServer();   // the files are in use while Yukti runs
      featureRestart = true;                        // …so it must be started again on the way back
      await installer.removeFeature(config.installRoot, feature);
      log(`[add-on] ${feature} removed`);
      result = { ok: true, feature, removing: true, restart: true };
    }
  } catch (e) {
    log(`[add-on] ${feature} could not be removed: ${e.message}`);
    result = { ok: false, feature, removing: true, error: e.message };
  }
  removing = null;
  return finished('features', result);
});
handle('yukti:featuresDone', async () => {
  // back to Yukti; whether it must be restarted is known here (featureRestart), not taken from the page
  if (busyChanging()) return { ok: false, error: busyMessage(), plain: true };
  if (config.mode === 'local' && featureRestart && await startedOutside(config.installRoot)) {
    return { ok: false, error: T('main.outside'), plain: true };   // cannot be restarted from here
  }
  await leaveFeatures();
  return { ok: true };
});

handle('yukti:install', async (_e, req = {}) => {
  const url = String(req.manifestUrl || '').trim();
  const dest = String(req.dest || '').trim() || DEFAULT_DEST;
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: T('main.enterSource'), plain: true };
  if (busyChanging()) return { ok: false, error: busyMessage(), plain: true, running: true };
  const ctl = installAbort = new AbortController();
  lastInstall = null;
  buildMenu();
  const send = (p) => {
    if (p.message && p.phase !== 'download') log(`[install] ${p.message}`);
    sendUi('setup', 'install:progress', p);
    if (p.pct !== undefined && win && !win.isDestroyed()) win.setProgressBar(p.pct / 100);
  };
  let result;
  try {
    const refusal = unsignedRefusal('install');
    if (refusal) result = { ok: false, error: refusal, plain: true };
    else if (await startedOutside(dest)) {
      log(`[install] refused: the Yukti server in ${dest} was not started by this app and cannot be stopped by it`);
      result = { ok: false, error: T('main.outside'), plain: true };
    } else {
      if (serverAlive()) await stopLocalServer();   // updating a running install
      const r = await installer.install({ ...(await installerOpts(url, dest)), signal: ctl.signal, onProgress: send });
      // the update is in: do not offer it again (also remembered when the user chose "Later", see yukti:connect)
      config.mode = 'local'; config.installRoot = r.dest; config.manifestUrl = url; config.startedOnce = false; config.updateOffered = app.getVersion(); saveConfig();
      featureRestart = false;
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      setTimeout(bootLocal, 900);   // let the page show "Installed" for a moment
      result = { ok: true, version: r.version };
    }
  } catch (e) {
    const cancelled = ctl.signal.aborted;
    if (!cancelled) log(`[install] ERROR: ${e.message}`);
    if (win && !win.isDestroyed()) win.setProgressBar(cancelled ? -1 : 1, { mode: cancelled ? 'none' : 'error' });
    result = { ok: false, cancelled, error: e.message };
  }
  installAbort = null;
  return finished('setup', result);
});
handle('yukti:cancelInstall', () => { if (installAbort) installAbort.abort(); return true; });
handle('yukti:splashInit', () => ({ logs: logBuf.slice(-500), status: lastStatus, port: server ? server.port : config.localPort, version: app.getVersion(), lang: lang() }));
handle('yukti:setLang', (_e, l) => { if (YI.LANGS.includes(l)) { config.lang = l; saveConfig(); buildMenu(); updateTray(); } return { ok: true, lang: lang() }; });
handle('yukti:report', (_e, req = {}) => { reportProblem(String((req && req.context) || '').slice(0, 4000)); return { ok: true }; });
handle('yukti:splashAction', async (_e, action) => {
  if (action === 'settings') { bootSeq++; showSetup(); }
  else if (action === 'retry') {
    bootSeq++;
    log('[yukti-desktop] ---- retry ----');
    // connected to a plant server (this page then only appears when the Yukti page kept stopping): just open it again
    if (config.mode === 'remote') { openApp(activeUrl || config.serverUrl); return true; }
    await stopLocalServer();
    bootLocal();
  } else if (action === 'open') {
    const base = (server && server.url) || config.serverUrl;
    bootSeq++; openApp(base);
  } else if (action === 'logs') openLogs('server');
  else if (action === 'quit') quitApp();
  return true;
});

// ------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWin);
  app.whenReady().then(async () => {
    loadConfig();
    openLogFile();
    setupSession();
    ensureTray();
    const bundle = bundledServer();
    if (bundle) {
      ensureShortcuts();
      // first run of the single-zip build, or the previous folder was replaced/moved by a newer version: use this bundle
      if (!config.mode || (config.mode === 'local' && !serverKind(config.installRoot))) {
        if (config.installRoot !== bundle) config.startedOnce = false;
        config.mode = 'local'; config.installRoot = bundle; saveConfig();
        log(`[setup] using the Yukti Server bundled with this app: ${bundle}`);
      }
    }
    if (runningFromZipPreview()) {
      showSetup(T('main.zip'));
      return;
    }
    // this app is newer than the installed server (the user ran a new Yukti-Setup.exe): offer the update — until the
    // user says "Later" or the update is installed (config.updateOffered is set there, not here)
    if (!bundle && config.mode === 'local' && serverKind(config.installRoot) && manifestUrl() && config.updateOffered !== app.getVersion()) {
      const inst = await installer.installedVersion(config.installRoot);
      if (inst && inst.version && inst.version !== app.getVersion()) {
        // the window comes first (start-up page): the check below needs the internet and must not leave the user
        // looking at nothing for seconds
        const seq = ++bootSeq;
        lastStatus = null;
        showSplash();
        setStatus({ step: 'check', text: T('main.checking'), secs: 0 });
        // offer it only when the new parts can actually be downloaded now (plant PCs are often offline): otherwise
        // start the installed version as usual and offer again next time. A short wait only — a slow or missing
        // connection must not hold up the start.
        let latest = null;
        if (unsignedRefusal('update check')) { /* this build cannot check a download: start what is installed */ }
        else {
          try {
            latest = await Promise.race([installer.fetchManifest(manifestUrl(), releaseKey(), 3000, netFetch),
              new Promise((_r, j) => setTimeout(() => j(new Error('no answer within 3 s')), 3000))]);
          } catch (e) { log(`[setup] update check skipped: ${e.message}`); }
        }
        if (seq !== bootSeq || quitting) return;   // the user went to the setup page (or quit) meanwhile
        if (latest && latest.version !== inst.version) {
          log(`[setup] installed Yukti ${inst.version}, available ${latest.version}: offering the update`);
          showSetup();
          return;
        }
      }
    }
    if (config.mode === 'local' && serverKind(config.installRoot)) bootLocal();
    else if (config.mode === 'remote') {
      const h = await health(config.serverUrl, 4000);
      if (h.ok) openApp(config.serverUrl);
      else showSetup(`${T('main.unreachable', { url: config.serverUrl })} (${h.error})`);
    } else if (config.mode === 'local') showSetup(T('main.noServer'));
    else showSetup();
  });

  app.on('before-quit', (e) => {
    quitting = true;
    bootSeq++;
    if (installAbort) installAbort.abort();
    if (serverAlive()) {
      e.preventDefault();
      // stopping the server takes a few seconds: the window goes at once, so Yukti does not look frozen
      if (win && !win.isDestroyed()) win.hide();
      stopLocalServer().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => { if (!tray || quitting) app.quit(); });
}
