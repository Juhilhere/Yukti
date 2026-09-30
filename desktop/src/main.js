// Yukti desktop — Electron main process.
// ONE window ("Yukti") walks through: setup page → install progress → startup page → the Yukti web app, all via
// loadFile / loadURL on the same BrowserWindow.
// Modes: "remote" (connect to a Yukti server on the plant network) or
// "local" (all-in-one: start the Yukti server on this PC as a child process).
// Offline by design: no telemetry, no auto-update, no CDN.
'use strict';
const SUPPORT_EMAIL = 'juhilprogramming@gmail.com';  // problem reports (Help menu)
const YI = require('./ui/i18n.js');
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage, session } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const installer = require('./installer');

const DEBUG = process.env.YUKTI_DEBUG === '1';
const ROOT = path.join(__dirname, '..');
const UI = (f) => path.join(__dirname, 'ui', f);
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const TRAY_PNG = path.join(ROOT, 'build', 'tray.png');
const BG = '#0e0e10';
const DEFAULT_PORT = 8000;
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

function distribution() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'distribution.json'), 'utf8')); } catch { return {}; }
}

app.setAppUserModelId('in.uniminds.yukti');
// Keep Chromium quiet on the network: no component updates / background pings.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

let config = { ...DEFAULTS };
let win = null, tray = null;
let page = null;              // 'setup' | 'splash' | 'app'
let server = null;            // { proc, exited, root, port, url } when we own the local server
let activeUrl = null;         // origin of the Yukti app currently (or last) shown in the window
let quitting = false, stopping = false;
let installAbort = null;
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
  if (o.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(o)) {
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', o);
  }
} catch { /* first start: no saved server yet */ }

// ------------------------------------------------------------ health
async function health(base, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store', headers: { 'X-Lang': lang() } });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    if (!j || j.ok !== true) return { ok: false, error: 'Not a Yukti server (unexpected /api/health reply)' };
    return { ok: true, version: j.version, engine: j.engine, raw: j };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out' : (e.cause && e.cause.code) || e.message };
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
  sendUi('splash', 'splash:log', s);
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
  if (!kind) throw new Error(`No Yukti Server found at ${installRoot} (expected yukti-server.exe)`);
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
    if (code === 75 && !quitting && !stopping && server === me) {
      log('[yukti-desktop] server requested a restart');
      bootSeq++;
      showSplash();
      setTimeout(bootLocal, 500);
      updateTray();
      return;
    }
    if (me.error == null && code) me.error = `The Yukti server exited with code ${code}.`;
    // stopped unexpectedly while the user works in the app → show the startup page with the error panel
    if (!quitting && !stopping && server === me && page === 'app' && activeUrl === me.url) {
      bootSeq++;
      showSplash();
      failStart(T('main.stopped'));
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
async function stopLocalServer() {
  if (!server || server.exited || !server.proc.pid) { server = null; return; }
  stopping = true;
  const { proc } = server;
  log('[yukti-desktop] stopping local server…');
  // 1) polite: taskkill without /F (WM_CLOSE / CTRL-signal to the tree)
  await taskkill(proc.pid, false);
  let done = await waitExit(proc, 4000);
  // 2) fallback: force-kill the whole tree (uv → python → llama-server)
  if (!done) { await taskkill(proc.pid, true); done = await waitExit(proc, 4000); }
  server = null; stopping = false;
  updateTray();
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
  if (serverAlive() && server.root === config.installRoot) base = server.url;       // ours, still running
  else {
    if (serverAlive()) await stopLocalServer();                                   // ours, but another folder
    for (const port of [...new Set([DEFAULT_PORT, config.localPort].filter(Boolean))]) {
      const h = await health(localUrl(port), 1500);
      if (!h.ok) continue;
      // only reuse a server started from THIS install folder (not an older version or another copy)
      if (h.instance && h.instance !== instanceId(config.installRoot)) {
        log(`[yukti-desktop] a different Yukti installation is running on ${localUrl(port)} — starting this one on another port.`);
        continue;
      }
      base = localUrl(port); log(`[yukti-desktop] Yukti ${h.version} already serving on ${base} — connecting.`); break;
    }
  }
  if (!live()) return;
  if (!base) {
    let port = DEFAULT_PORT;
    if (!(await portFree(DEFAULT_PORT))) {  // also when another Yukti installation holds 8000
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
  const own = server && server.url === base ? server : null;
  let upSince = null;
  let h = { ok: false };
  while (live()) {
    if (own && own.exited) return failStart(own.error || T('main.exited'));
    h = await health(base, 2500);
    if (!live()) return;
    const secs = Math.round((Date.now() - t0) / 1000);
    setStatus({ step: 'wait', secs, firstRun, limitSecs: limit / 1000, up: h.ok, health: h.ok ? h.raw : null, error: null, reachError: h.ok ? null : h.error });
    if (h.ok) {
      upSince = upSince || Date.now();
      const j = h.raw || {};
      if (j.engine === 'error') {
        log(`[yukti-desktop] AI engine reported an error${j.error ? ': ' + j.error : ''} — opening Yukti anyway.`);
        setStatus({ ...lastStatus, notice: T('main.modelNotice') });
        await sleep(2000);
        if (live()) openApp(base, true);
        return;
      }
      const legacyReady = j.ready === undefined && (j.engine === 'ready' || (j.engine === 'idle' && Date.now() - upSince > 15000));
      if (j.ready === true || legacyReady) {
        setStatus({ ...lastStatus, done: true });
        await sleep(350);
        if (live()) openApp(base, true);
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

function createWindow() {
  const b = config.bounds || {};
  win = new BrowserWindow({
    width: Math.max(1200, b.width || 1440), height: Math.max(760, b.height || 900),
    x: b.x, y: b.y, minWidth: 1200, minHeight: 760, title: 'Yukti', icon: winIcon(), show: false,
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
    if (!quitting && tray && (page === 'app' || serverAlive())) { e.preventDefault(); win.hide(); }
    else if (!quitting) quitApp();
  });
  win.on('closed', () => { win = null; });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('Yukti'); });
  win.once('ready-to-show', () => win.show());
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
  if (!win.isVisible() && win.webContents.getURL()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function showSetup(notice) {
  if (notice) setupNotice = notice;
  page = 'setup';
  ensureWin().loadFile(UI('connect.html'));
  win.setProgressBar(-1);
  showWin();
  buildMenu();
}
function showSplash() {
  page = 'splash';
  ensureWin().loadFile(UI('splash.html'));
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
  ensureWin().loadURL(base + (syncLang ? `/?lang=${lang()}` : '/'));
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
  wc.on('will-navigate', (e, url) => {
    if (allowed(url)) return;
    e.preventDefault();
    if (isHttp(url)) shell.openExternal(url); // user-clicked link to another host (e.g. a source citation)
    else if (/^mailto:/i.test(url)) shell.openExternal(url); // e.g. Help > Report a problem
  });
  wc.on('will-redirect', (e, url) => { if (isHttp(url) && page === 'app' && !sameOrigin(url, activeUrl)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
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
  } else if (win && !win.isDestroyed()) win.webContents.reload();
}

function about() {
  const owns = serverAlive() ? ` — server started by this app (port ${server.port})` : '';
  dialog.showMessageBox(win || undefined, {
    type: 'info', title: T('menu.about'), icon: winIcon(),
    message: `Yukti ${app.getVersion()}`,
    detail: `Sovereign Industrial AI Workbench\n\nConnected server: ${activeUrl || '(none)'}\nMode: ${modeLabel()}${owns}\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\nOffline build — no telemetry, no auto-update.

Report a problem: ${SUPPORT_EMAIL}`,
  });
}

function buildMenu() {
  const tpl = [
    { label: T('menu.file'), submenu: [
      { label: T('menu.switch'), accelerator: 'CmdOrCtrl+Shift+S', enabled: page !== 'setup', click: () => { bootSeq++; showSetup(); } },
      { label: T('menu.reload'), accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
      { type: 'separator' },
      { label: T('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => quitApp() },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
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
  tray.on('double-click', showMainWin);
  updateTray();
}
function showMainWin() {
  if (win && !win.isDestroyed()) { win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
  else if (page === 'app' && activeUrl) openApp(activeUrl);
  else showSetup();
}
async function serverStatus() {
  const base = activeUrl || config.serverUrl;
  const h = await health(base, 4000);
  const j = h.raw || {};
  const detail = h.ok ? `Server: ${base}\nVersion: ${h.version}\nEngine: ${h.engine}${j.stage ? `\nStatus: ${j.stage}` : ''}\nMode: ${modeLabel()}` : `Server: ${base}\nUnreachable: ${h.error}\nMode: ${modeLabel()}`;
  dialog.showMessageBox({ type: h.ok ? 'info' : 'warning', title: T('main.statusTitle'), message: h.ok ? T('main.online') : T('main.offline'), detail, icon: winIcon() });
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
    bootSeq++;
    setImmediate(() => openApp(base));
    return { ok: true };
  }
  if (req.mode === 'local') {
    const root = String(req.installRoot || '').trim();
    if (!serverKind(root)) return { ok: false, error: T('main.noServerAt', { root }) };
    if (config.installRoot !== root) config.startedOnce = false;
    config.mode = 'local'; config.installRoot = root; saveConfig();
    setImmediate(bootLocal);
    return { ok: true };
  }
  return { ok: false, error: 'Unknown mode' };
});

let gpuPromise = null;
handle('yukti:plan', async (_e, req = {}) => {
  const url = String(req.manifestUrl || '').trim();
  const dest = String(req.dest || '').trim() || DEFAULT_DEST;
  const installed = await installer.installedVersion(dest);
  if (!/^https?:\/\//i.test(url)) return { ok: false, dest, installed, error: null };
  try {
    gpuPromise = gpuPromise || installer.hasNvidiaGpu();
    const p = await installer.plan({ manifestUrl: url, publicKey: distribution().publicKey || null, dest, forceGpu: await gpuPromise });
    delete p.manifest;
    return { ok: true, dest, installed, plan: p, updateAvailable: !!(installed && installed.version && installed.version !== p.version) };
  } catch (e) { return { ok: false, dest, installed, error: e.message }; }
});
handle('yukti:install', async (_e, req = {}) => {
  const url = String(req.manifestUrl || '').trim();
  const dest = String(req.dest || '').trim() || DEFAULT_DEST;
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Enter the download source (the manifest.json URL from your organisation's Yukti page)." };
  if (installAbort) return { ok: false, error: T('main.installRunning') };
  installAbort = new AbortController();
  const send = (p) => {
    if (p.message && p.phase !== 'download') log(`[install] ${p.message}`);
    sendUi('setup', 'install:progress', p);
    if (p.pct !== undefined && win && !win.isDestroyed()) win.setProgressBar(p.pct / 100);
  };
  try {
    if (serverAlive()) await stopLocalServer();   // updating a running install
    gpuPromise = gpuPromise || installer.hasNvidiaGpu();
    const r = await installer.install({ manifestUrl: url, publicKey: distribution().publicKey || null, dest, signal: installAbort.signal, onProgress: send, forceGpu: await gpuPromise });
    config.mode = 'local'; config.installRoot = r.dest; config.manifestUrl = url; config.startedOnce = false; saveConfig();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    setTimeout(bootLocal, 900);   // let the page show "Installed" for a moment
    return { ok: true, version: r.version };
  } catch (e) {
    const cancelled = !!(installAbort && installAbort.signal.aborted);
    if (!cancelled) log(`[install] ERROR: ${e.message}`);
    if (win && !win.isDestroyed()) win.setProgressBar(cancelled ? -1 : 1, { mode: cancelled ? 'none' : 'error' });
    return { ok: false, cancelled, error: e.message };
  } finally { installAbort = null; }
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
    // this app is newer than the installed server (the user ran a new Yukti-Setup.exe): offer the update once
    if (!bundle && config.mode === 'local' && serverKind(config.installRoot) && manifestUrl() && config.updateOffered !== app.getVersion()) {
      const inst = await installer.installedVersion(config.installRoot);
      if (inst && inst.version && inst.version !== app.getVersion()) {
        config.updateOffered = app.getVersion(); saveConfig();
        log(`[setup] installed Yukti ${inst.version}, this app is ${app.getVersion()}: offering the update`);
        showSetup();
        return;
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
      stopLocalServer().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => { if (!tray || quitting) app.quit(); });
}
