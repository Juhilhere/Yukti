// Yukti desktop — Electron main process.
// Modes: "remote" (connect to a Yukti server on the plant network) or
// "local" (all-in-one: start the Yukti server on this PC as a child process).
// Offline by design: no telemetry, no auto-update, no CDN.
'use strict';
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage, session } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEBUG = process.env.YUKTI_DEBUG === '1';
const ROOT = path.join(__dirname, '..');
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const TRAY_PNG = path.join(ROOT, 'build', 'tray.png');
const LOCAL_URL = 'http://127.0.0.1:8000';
const installer = require('./installer');
// Download source for "Install Yukti on this PC": set at build time in distribution.json (the publisher's website).
function distribution() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'distribution.json'), 'utf8')); } catch { return {}; }
}
const DEFAULT_DEST = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'Yukti', 'Server');
let installAbort = null;
const DEFAULTS = { mode: null, serverUrl: LOCAL_URL, installRoot: DEFAULT_DEST, manifestUrl: null, bounds: null };
const READY_TIMEOUT_MS = 180000;

app.setAppUserModelId('in.uniminds.yukti');
// Keep Chromium quiet on the network: no component updates / background pings.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

let config = { ...DEFAULTS };
let mainWin = null, connectWin = null, splashWin = null, tray = null;
let server = null;            // { proc, logs[] } when we own the local server
let activeUrl = null;         // origin currently loaded in the main window
let quitting = false, stopping = false;
const logBuf = [];

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
  const url = new URL(s);
  return url.origin;
}

// ------------------------------------------------------------ health
async function health(base, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    if (!j || j.ok !== true) return { ok: false, error: 'Not a Yukti server (unexpected /api/health reply)' };
    return { ok: true, version: j.version, engine: j.engine };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out' : (e.cause && e.cause.code) || e.message };
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------ logs
function log(line) {
  const s = String(line).replace(/\r?\n$/, '');
  if (!s) return;
  logBuf.push(s);
  if (logBuf.length > 2000) logBuf.splice(0, logBuf.length - 2000);
  if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('splash:log', s);
}
function status(text, extra = {}) {
  if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('splash:status', { text, ...extra });
}

// ------------------------------------------------------------ local server
function serverKind(root) {
  if (fs.existsSync(path.join(root, 'yukti-server.exe'))) return 'bundle';          // shipped, self-contained package
  if (fs.existsSync(path.join(root, 'backend', 'app', 'main.py'))) return 'dev';     // developer checkout (uv)
  return null;
}

function startLocalServer(installRoot) {
  const kind = serverKind(installRoot);
  if (!kind) throw new Error(`No Yukti Server found at ${installRoot} (expected yukti-server.exe)`);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  let proc;
  if (kind === 'bundle') {
    const exe = path.join(installRoot, 'yukti-server.exe');
    const args = ['--host', '127.0.0.1', '--port', '8000'];
    log(`> ${exe} ${args.join(' ')}`);
    proc = spawn(exe, args, { cwd: installRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    const backend = path.join(installRoot, 'backend');
    env.UV_CACHE_DIR = process.env.UV_CACHE_DIR || 'E:/uvcache';
    const args = ['run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'];
    log(`> uv ${args.join(' ')}   (cwd ${backend})`);
    proc = spawn('uv', args, { cwd: backend, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  server = { proc, exited: false };
  const pipe = (stream) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => { rest += d; const lines = rest.split(/\r?\n/); rest = lines.pop(); lines.forEach(log); });
    stream.on('end', () => rest && log(rest));
  };
  pipe(proc.stdout); pipe(proc.stderr);
  proc.on('error', (e) => { log(`[yukti-desktop] failed to start the Yukti server: ${e.message}`); server && (server.exited = true, server.error = e.message); });
  proc.on('exit', (code, sig) => {
    log(`[yukti-desktop] server exited (code ${code}${sig ? ', ' + sig : ''})`);
    if (server && server.proc === proc) server.exited = true;
    if (!quitting && !stopping && mainWin && activeUrl === LOCAL_URL) {
      dialog.showMessageBox(mainWin, { type: 'warning', title: 'Yukti', message: 'The local Yukti server stopped.', detail: logBuf.slice(-12).join('\n') });
    }
    updateTray();
  });
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
}

async function bootLocal() {
  showSplash();
  status('Checking for a running Yukti server on this PC…');
  const pre = await health(LOCAL_URL, 2000);
  if (pre.ok) {
    log(`[yukti-desktop] Yukti ${pre.version} already serving on ${LOCAL_URL} — connecting.`);
    return waitReadyThenOpen(LOCAL_URL, Date.now());
  }
  try { startLocalServer(config.installRoot); } catch (e) { return splashFail(e.message); }
  status('Starting Yukti server…');
  return waitReadyThenOpen(LOCAL_URL, Date.now());
}

async function waitReadyThenOpen(base, t0) {
  let upSince = null;
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    if (!splashWin || splashWin.isDestroyed()) return; // user closed / switched
    if (server && server.exited && base === LOCAL_URL) return splashFail(server.error || 'The Yukti server process exited during start-up. See logs.');
    const h = await health(base, 2500);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (h.ok) {
      upSince = upSince || Date.now();
      status(`Server up (v${h.version}) — engine: ${h.engine}`, { secs, engine: h.engine, pct: h.engine === 'ready' ? 100 : 70 });
      if (h.engine === 'ready' || h.engine === 'error') break;
      // "idle" = no model auto-loaded; do not wait forever for it
      if (h.engine === 'idle' && Date.now() - upSince > 15000) break;
    } else {
      status(`Waiting for server… (${secs}s)`, { secs, pct: Math.min(60, 5 + secs) });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const h = await health(base, 3000);
  if (!h.ok) return splashFail(`Server did not respond within ${READY_TIMEOUT_MS / 1000}s.`);
  if (h.engine === 'error') log('[yukti-desktop] engine reported "error" — opening UI anyway so you can inspect /models.');
  openMain(base);
}

function splashFail(msg) {
  log(`[yukti-desktop] ERROR: ${msg}`);
  status(msg, { error: true });
}

// ------------------------------------------------------------ windows
function winIcon() { return nativeImage.createFromPath(ICON_PNG); }

function showConnect() {
  if (connectWin && !connectWin.isDestroyed()) return connectWin.focus();
  connectWin = new BrowserWindow({
    width: 680, height: 820, resizable: true, minimizable: true, maximizable: false, title: 'Set up Yukti',
    icon: winIcon(), show: false, autoHideMenuBar: true, backgroundColor: '#0e0e10',
    parent: mainWin && !mainWin.isDestroyed() ? mainWin : undefined, modal: !!(mainWin && !mainWin.isDestroyed()),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  connectWin.setMenu(null);
  lockDown(connectWin.webContents, null);
  connectWin.loadFile(path.join(__dirname, 'ui', 'connect.html'));
  connectWin.once('ready-to-show', () => connectWin.show());
  connectWin.on('closed', () => {
    connectWin = null;
    if (!mainWin && !splashWin && !quitting) app.quit();
  });
}

function showSplash() {
  if (splashWin && !splashWin.isDestroyed()) return;
  splashWin = new BrowserWindow({
    width: 640, height: 440, resizable: true, frame: true, title: 'Starting Yukti', icon: winIcon(), show: false,
    autoHideMenuBar: true, backgroundColor: '#0e0e10',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWin.setMenu(null);
  lockDown(splashWin.webContents, null);
  splashWin.loadFile(path.join(__dirname, 'ui', 'splash.html'));
  splashWin.webContents.once('did-finish-load', () => { logBuf.forEach((l) => splashWin.webContents.send('splash:log', l)); });
  splashWin.once('ready-to-show', () => splashWin.show());
  splashWin.on('closed', () => {
    splashWin = null;
    if (!mainWin && !connectWin && !quitting) app.quit();
  });
}

function openMain(base) {
  activeUrl = base;
  if (!mainWin || mainWin.isDestroyed()) {
    const b = config.bounds || {};
    mainWin = new BrowserWindow({
      width: Math.max(1200, b.width || 1440), height: Math.max(760, b.height || 900),
      x: b.x, y: b.y, minWidth: 1200, minHeight: 760, title: 'Yukti', icon: winIcon(), show: false,
      backgroundColor: '#0e0e10', autoHideMenuBar: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: DEBUG },
    });
    if (b.maximized) mainWin.maximize();
    const persist = () => {
      if (!mainWin || mainWin.isDestroyed()) return;
      config.bounds = { ...(mainWin.isMaximized() || mainWin.isFullScreen() ? (config.bounds || {}) : mainWin.getBounds()), maximized: mainWin.isMaximized() };
      saveConfig();
    };
    mainWin.on('resize', debounce(persist, 500));
    mainWin.on('move', debounce(persist, 500));
    mainWin.on('close', (e) => {
      persist();
      // closing the window keeps the app in the tray only if a tray exists; otherwise quit
      if (!quitting && tray) { e.preventDefault(); mainWin.hide(); }
    });
    mainWin.on('closed', () => { mainWin = null; });
    mainWin.on('page-title-updated', (e) => { e.preventDefault(); mainWin.setTitle('Yukti'); });
    mainWin.once('ready-to-show', () => mainWin.show());
    mainWin.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) {
        dialog.showMessageBox(mainWin, { type: 'error', title: 'Yukti', message: `Could not load ${url}`, detail: `${desc} (${code}). Use File → Switch server… or File → Reload.` });
      }
    });
  }
  lockDown(mainWin.webContents, () => activeUrl);
  mainWin.loadURL(base + '/');
  buildMenu();
  ensureTray();
  if (splashWin && !splashWin.isDestroyed()) { const s = splashWin; splashWin = null; s.close(); }
  mainWin.show();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ------------------------------------------------------------ security
function isHttp(u) { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } }
function sameOrigin(u, base) { try { return !!base && new URL(u).origin === new URL(base).origin; } catch { return false; } }

const locked = new WeakSet();
function lockDown(wc, getBase) {
  if (locked.has(wc)) return;
  locked.add(wc);
  const allowed = (u) => (getBase ? sameOrigin(u, getBase()) : u.startsWith('file://'));
  wc.on('will-navigate', (e, url) => {
    if (allowed(url)) return;
    e.preventDefault();
    if (getBase && isHttp(url)) shell.openExternal(url); // user-clicked link to another host (e.g. a source citation)
  });
  wc.on('will-redirect', (e, url) => { if (!allowed(url)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (getBase && sameOrigin(url, getBase())) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: winIcon(), autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (isHttp(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => lockDown(child.webContents, getBase));
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

function setupSession() {
  const ses = session.defaultSession;
  // deny powerful permissions except clipboard write / notifications from the configured server
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ok = ['clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(perm) && sameOrigin(details.requestingUrl || wc.getURL(), activeUrl);
    cb(ok);
  });
  ses.on('will-download', (_e, item) => {
    const def = path.join(app.getPath('downloads'), item.getFilename());
    const parent = BrowserWindow.getFocusedWindow() || mainWin;
    const target = dialog.showSaveDialogSync(parent, { title: 'Save file', defaultPath: def });
    if (!target) { item.cancel(); return; }
    item.setSavePath(target);
    item.once('done', (_ev, state) => {
      if (state === 'completed') {
        if (parent && !parent.isDestroyed()) parent.setProgressBar(-1);
      } else if (state !== 'cancelled') {
        dialog.showMessageBox(parent, { type: 'error', title: 'Download failed', message: `Download ${state}: ${path.basename(target)}` });
      }
    });
    item.on('updated', () => {
      const tot = item.getTotalBytes();
      if (parent && !parent.isDestroyed() && tot > 0) parent.setProgressBar(item.getReceivedBytes() / tot);
    });
  });
}

// ------------------------------------------------------------ menu / tray / about
function modeLabel() { return config.mode === 'local' ? 'All-in-one (this PC)' : 'Plant network client'; }

function about() {
  const owns = server && !server.exited ? ' — server started by this app' : '';
  dialog.showMessageBox(mainWin || undefined, {
    type: 'info', title: 'About Yukti', icon: winIcon(),
    message: `Yukti ${app.getVersion()}`,
    detail: `Sovereign Industrial AI Workbench\n\nConnected server: ${activeUrl || '(none)'}\nMode: ${modeLabel()}${owns}\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\nOffline build — no telemetry, no auto-update.`,
  });
}

function buildMenu() {
  const tpl = [
    { label: 'File', submenu: [
      { label: 'Switch server / Install or update…', accelerator: 'CmdOrCtrl+Shift+S', click: () => showConnect() },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWin && mainWin.webContents.reload() },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => quitApp() },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(DEBUG ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
    ] },
    { label: 'Help', submenu: [{ label: 'About Yukti', click: about }] },
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
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  else if (activeUrl) openMain(activeUrl);
  else showConnect();
}
async function serverStatus() {
  const base = activeUrl || config.serverUrl;
  const h = await health(base, 4000);
  const detail = h.ok ? `Server: ${base}\nVersion: ${h.version}\nEngine: ${h.engine}\nMode: ${modeLabel()}` : `Server: ${base}\nUnreachable: ${h.error}\nMode: ${modeLabel()}`;
  dialog.showMessageBox({ type: h.ok ? 'info' : 'warning', title: 'Yukti server status', message: h.ok ? 'Yukti server is online' : 'Yukti server is not responding', detail, icon: winIcon() });
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Yukti', click: showMainWin },
    { label: 'Server status', click: serverStatus },
    { type: 'separator' },
    { label: config.mode === 'local' ? 'Quit (stops local server)' : 'Quit', click: () => quitApp() },
  ]));
}

function quitApp() { quitting = true; app.quit(); }

// ------------------------------------------------------------ IPC (connect + splash windows)
ipcMain.handle('yukti:getConfig', () => ({ mode: config.mode, serverUrl: config.serverUrl, installRoot: config.installRoot, version: app.getVersion(), connected: activeUrl }));
ipcMain.handle('yukti:test', async (_e, url) => {
  let base; try { base = normUrl(url); } catch { return { ok: false, error: 'Invalid URL' }; }
  return { base, ...(await health(base, 5000)) };
});
ipcMain.handle('yukti:browseRoot', async () => {
  const r = await dialog.showOpenDialog(connectWin || undefined, { title: 'Select the Yukti installation folder', properties: ['openDirectory'], defaultPath: config.installRoot });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('yukti:connect', async (_e, req) => {
  if (req.mode === 'remote') {
    let base; try { base = normUrl(req.serverUrl); } catch { return { ok: false, error: 'Invalid URL' }; }
    const h = await health(base, 5000);
    if (!h.ok) return { ok: false, error: `Cannot reach Yukti at ${base}: ${h.error}` };
    if (config.mode === 'local' && base !== LOCAL_URL) await stopLocalServer();
    config.mode = 'remote'; config.serverUrl = base; saveConfig();
    const cw = connectWin; connectWin = null;
    openMain(base);
    if (cw && !cw.isDestroyed()) cw.destroy();
    return { ok: true };
  }
  if (req.mode === 'local') {
    const root = String(req.installRoot || '').trim();
    if (!serverKind(root)) return { ok: false, error: `No Yukti Server at ${root} (expected yukti-server.exe)` };
    config.mode = 'local'; config.installRoot = root; config.serverUrl = LOCAL_URL; saveConfig();
    const cw = connectWin; connectWin = null;
    if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
    bootLocal();
    if (cw && !cw.isDestroyed()) cw.destroy();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown mode' };
});
ipcMain.handle('yukti:installInfo', async () => {
  const manifestUrl = config.manifestUrl || distribution().manifestUrl || '';
  const dest = config.mode === 'local' && config.installRoot ? config.installRoot : DEFAULT_DEST;
  const installed = await installer.installedVersion(dest);
  const out = { manifestUrl, dest, installed };
  if (manifestUrl) {
    try {
      const m = await installer.fetchManifest(manifestUrl);
      const nvidia = await installer.hasNvidiaGpu();
      out.latest = m.version;
      out.size = m.artifacts.filter((a) => !(a.requires === 'nvidia' && !nvidia)).reduce((t, a) => t + a.size, 0);
      out.updateAvailable = !!installed && installed.version !== m.version;
    } catch (e) { out.error = e.message; }
  }
  return out;
});
ipcMain.handle('yukti:install', async (_e, req) => {
  const manifestUrl = String(req.manifestUrl || '').trim();
  const dest = String(req.dest || '').trim() || DEFAULT_DEST;
  if (!/^https?:\/\//i.test(manifestUrl)) return { ok: false, error: "Enter the download source (the manifest.json URL from your organisation's Yukti page)." };
  installAbort = new AbortController();
  const send = (p) => {
    if (!connectWin || connectWin.isDestroyed()) return;
    connectWin.webContents.send('install:progress', p);
    if (p.pct !== undefined) connectWin.setProgressBar(p.pct / 100);
  };
  try {
    if (server && !server.exited) await stopLocalServer();   // updating a running install
    const r = await installer.install({ manifestUrl, dest, signal: installAbort.signal, onProgress: send });
    config.mode = 'local'; config.installRoot = r.dest; config.serverUrl = LOCAL_URL; config.manifestUrl = manifestUrl; saveConfig();
    const cw = connectWin; connectWin = null;
    if (cw && !cw.isDestroyed()) cw.setProgressBar(-1);
    if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
    bootLocal();
    if (cw && !cw.isDestroyed()) cw.destroy();
    return { ok: true };
  } catch (e) {
    if (connectWin && !connectWin.isDestroyed()) connectWin.setProgressBar(-1);
    return { ok: false, error: e.message };
  } finally { installAbort = null; }
});
ipcMain.handle('yukti:cancelInstall', () => { if (installAbort) installAbort.abort(); return true; });
ipcMain.handle('yukti:splashAction', async (_e, action) => {
  if (action === 'settings') {
    await stopLocalServer();
    const s = splashWin; splashWin = null;
    showConnect();
    if (s && !s.isDestroyed()) s.destroy();
  } else if (action === 'retry') {
    logBuf.length = 0; await stopLocalServer();
    const s = splashWin; splashWin = null; if (s && !s.isDestroyed()) s.destroy();
    bootLocal();
  } else if (action === 'quit') quitApp();
});

// ------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWin);
  app.whenReady().then(() => {
    loadConfig();
    setupSession();
    Menu.setApplicationMenu(null);
    if (config.mode === 'local') bootLocal();
    else if (config.mode === 'remote') {
      health(config.serverUrl, 4000).then((h) => (h.ok ? openMain(config.serverUrl) : showConnect()));
    } else showConnect();
  });

  app.on('before-quit', (e) => {
    quitting = true;
    if (server && !server.exited) {
      e.preventDefault();
      stopLocalServer().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
