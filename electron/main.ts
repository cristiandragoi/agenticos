import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  createBackendLifecycleManager,
  httpHealthProbe,
  spawnBackendWithElectronNode,
  readPortFromServerEnv,
  type BackendLifecycleManager,
  type BackendMode,
} from './backendLifecycle';

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const ELECTRON_RENDERER_ROUTE = process.env['AGENTICOS_ELECTRON_ROUTE'] || '#/mission-control';
const REMOTE_DEBUGGING_PORT = process.env['AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT'];

/**
 * Backend lifecycle mode resolution (see docs/backend-lifecycle.md):
 *   AGENTICOS_BACKEND_MODE=AUTO_MANAGED|EXTERNAL  (explicit override)
 *   AGENTICOS_EXTERNAL_SERVERS=true               (legacy dev-clean.ps1 flag → EXTERNAL)
 *   default                                       → AUTO_MANAGED
 */
function resolveBackendMode(): BackendMode {
  const explicit = process.env['AGENTICOS_BACKEND_MODE'];
  if (explicit === 'EXTERNAL' || explicit === 'AUTO_MANAGED') return explicit;
  if (process.env['AGENTICOS_EXTERNAL_SERVERS'] === 'true') return 'EXTERNAL';
  return 'AUTO_MANAGED';
}
const BACKEND_MODE = resolveBackendMode();

/**
 * EPIPE hardening (dev-runtime stability): Electron main must NEVER crash
 * because a console/logging stream is closed. When vite-plugin-electron
 * owns Electron's stdout/stderr pipes and Vite exits, writes to the broken
 * pipe throw EPIPE. We (a) ignore stream-level errors on stdout/stderr and
 * (b) guard every console call so a closed pipe cannot raise an uncaught
 * exception. Real application errors still surface — only stream I/O
 * failures are absorbed.
 */
function hardenConsolePipes(): void {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream) {
      stream.on('error', (err: NodeJS.ErrnoException) => {
        if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) return; // pipe closed — ignore
        // Any other stream error: log what we can without recursing.
        try { console.error('[AgenticOS Electron] stdout/stderr stream error', err); } catch { /* ignore */ }
      });
    }
  }
}

/** Fail-safe console.log — never throws on a closed pipe. */
function safeLog(message: string, data?: unknown): void {
  const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`;
  try {
    console.log(line);
  } catch {
    // stdout pipe closed (EPIPE) — log is best-effort; the app keeps running.
  }
}

hardenConsolePipes();

if (REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUGGING_PORT);
  safeLog(`[AgenticOS Electron] Remote debugging port: ${REMOTE_DEBUGGING_PORT}`);
}

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;
let backendLifecycle: BackendLifecycleManager | null = null;
let backendShutdownStarted = false;

function logElectron(message: string, data?: unknown) {
  const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`;
  safeLog(line);
  const logFile = process.env['AGENTICOS_ELECTRON_LOG'] ||
    path.join(process.env.APP_ROOT || path.join(__dirname, '..'), '.agentos', 'logs', 'electron-dev.log');
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

/**
 * Build the backend lifecycle manager. Paths resolve from the Electron
 * app root (repo root in dev, packaged resources in production — the
 * electron-builder `files` list ships server/dist + server/node_modules
 * next to dist-electron), never from the shell working directory.
 */
function initBackendLifecycle(): BackendLifecycleManager {
  const appRoot = process.env.APP_ROOT as string;
  // Packaged mode: the backend runtime ships under resources/server (via
  // electron-builder extraResources), NOT inside resources/app — native
  // node_modules must live outside the app dir. Dev mode: repo root.
  const backendRoot = app.isPackaged ? process.resourcesPath : appRoot;
  const port = process.env['AGENTICOS_BACKEND_PORT']
    ? parseInt(process.env['AGENTICOS_BACKEND_PORT'], 10)
    : readPortFromServerEnv(backendRoot, 4000);
  const manager = createBackendLifecycleManager({
    mode: BACKEND_MODE,
    host: '127.0.0.1',
    port,
    entry: path.join(backendRoot, 'server', 'dist', 'index.js'),
    cwd: path.join(backendRoot, 'server'),
    // The Electron binary itself runs the backend as plain Node — the
    // packaged app ships no separate node executable.
    nodeExec: process.execPath,
    env: process.env,
    healthPath: '/api/health',
    healthProbeTimeoutMs: 2500,
    readinessPollMs: 1000,
    // Observed cold boot is ~20s (migrations + gateway checks); allow room
    // while still failing clearly when readiness never arrives.
    readyTimeoutMs: 60000,
    healthIntervalMs: 5000,
    maxRestarts: 3,
    backoffMs: [1000, 3000, 8000],
    crashThreshold: 3,
    crashWindowMs: 60000,
    unhealthyTolerance: 3,
    logFile: path.join(appRoot, '.agentos', 'logs', 'backend-managed.log'),
  }, {
    probe: httpHealthProbe,
    spawnBackend: spawnBackendWithElectronNode,
    log: (message) => logElectron(message),
  });
  manager.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try { window.webContents.send('backend-lifecycle:state', state); } catch { /* window closing */ }
    }
  });
  return manager;
}

function createWindow() {
  logElectron('Creating main window...');
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Agentic OS',
    icon: path.join(process.env.VITE_PUBLIC, 'logo.jpg'),
    frame: false,
    show: false, // Wait until ready-to-show
    backgroundColor: '#0a0a0d', // Solid dark color to prevent Windows transparency bugs
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Jarvis conversation VAD must stay operational while the window is
      // occluded/unfocused: the voice loop is driven by requestAnimationFrame,
      // which Chromium pauses for hidden windows unless background throttling
      // is disabled. Without this, speaking while the app is covered or
      // unfocused leaves the UI stuck on "Listening" with a dead mic pipeline.
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setAudioMuted(false);
  logElectron('[AgenticOS Electron] BrowserWindow count after create', { count: BrowserWindow.getAllWindows().length });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logElectron('[AgenticOS Renderer console]', { level, message, line, sourceId });
  });

  win.webContents.on('did-finish-load', async () => {
    const loadedUrl = win?.webContents.getURL() || 'unknown';
    let rendererInfo: any = {};
    try {
      rendererInfo = await win?.webContents.executeJavaScript(`({
        href: window.location.href,
        buildId: window.__AGENTICOS_RENDERER_BUILD_ID || null,
        buildTimestamp: window.__AGENTICOS_RENDERER_BUILD_TIMESTAMP || null,
        voiceControllerInstanceId: document.querySelector('[data-testid="jarvis-voice-diagnostics"]')?.textContent?.match(/voiceControllerInstanceId:\\s*([^\\n]+)/)?.[1]?.trim() || null
      })`);
    } catch (err: any) {
      rendererInfo = { error: err?.message || String(err) };
    }
    logElectron('[AgenticOS Electron] did-finish-load', {
      loadedUrl,
      rendererInfo,
      browserWindowCount: BrowserWindow.getAllWindows().length
    });
  });

  win.webContents.on('did-navigate-in-page', (_event, url) => {
    logElectron('[AgenticOS Electron] did-navigate-in-page', { url });
  });

  win.once('ready-to-show', () => {
    logElectron('Window ready-to-show triggered. Centering and showing...');
    win?.webContents.setAudioMuted(false);
    win?.center();
    win?.show();
    logElectron('[AgenticOS Electron] Window visible state', { isVisible: win?.isVisible(), bounds: win?.getBounds() });
  });

  if (VITE_DEV_SERVER_URL) {
    const targetUrl = `${VITE_DEV_SERVER_URL}${ELECTRON_RENDERER_ROUTE}`;
    logElectron('[AgenticOS Electron] Loading DEV server URL', { targetUrl });
    logElectron('[AgenticOS Electron] Vite URL', { viteUrl: VITE_DEV_SERVER_URL });
    logElectron('[AgenticOS Electron] Renderer route', { route: ELECTRON_RENDERER_ROUTE });
    logElectron('[AgenticOS Electron] Renderer build env', {
      buildId: process.env['VITE_AGENTICOS_BUILD_ID'] || process.env['AGENTICOS_RENDERER_BUILD_ID'] || 'unknown',
      buildTimestamp: process.env['VITE_AGENTICOS_BUILD_TIMESTAMP'] || process.env['AGENTICOS_RENDERER_BUILD_TIMESTAMP'] || 'unknown'
    });
    win.loadURL(targetUrl);
    win.webContents.openDevTools(); // Force DevTools in dev
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '/mission-control' });
  }
}

// Window control IPCs
ipcMain.on('window-minimize', () => win?.minimize());
ipcMain.on('window-maximize', () => {
  if (win?.isMaximized()) win?.unmaximize();
  else win?.maximize();
});
ipcMain.on('window-close', () => win?.close());

ipcMain.on('agenticos:renderer-diagnostics', (_event, payload) => {
  logElectron('[AgenticOS Electron] renderer-diagnostics', {
    payload,
    webContentsUrl: win?.webContents.getURL() || null,
    browserWindowCount: BrowserWindow.getAllWindows().length
  });
});

// ── Backend lifecycle IPC (one state machine feeds every UI surface) ──
ipcMain.handle('backend-lifecycle:get-state', () => backendLifecycle?.getState() ?? null);
ipcMain.handle('backend-lifecycle:restart', () => backendLifecycle?.restart() ?? { ok: false, reason: 'Lifecycle manager not initialized.' });
ipcMain.handle('backend-lifecycle:retry', () => backendLifecycle?.retry() ?? { ok: false, reason: 'Lifecycle manager not initialized.' });

function getAudioDiagnostics(webContents = win?.webContents) {
  const ownerWindow = webContents ? BrowserWindow.fromWebContents(webContents) : win;
  const inspectedContents = webContents || ownerWindow?.webContents || null;
  return {
    electronAvailable: true,
    webContentsAudioMuted: inspectedContents ? inspectedContents.isAudioMuted() : null,
    browserWindowAudioMuted: ownerWindow?.webContents ? ownerWindow.webContents.isAudioMuted() : null,
    sessionPartition: inspectedContents?.session?.partition || 'default',
    mediaPermissionPolicy: 'defaultSession allows media permission requests and checks',
    autoplayPolicy: 'no-user-gesture-required',
    windowsAppMuteState: 'not directly accessible from Electron main process'
  };
}

ipcMain.handle('voice:get-audio-diagnostics', (event) => {
  return getAudioDiagnostics(event.sender);
});

ipcMain.handle('voice:ensure-audio-unmuted', (event) => {
  event.sender.setAudioMuted(false);
  const ownerWindow = BrowserWindow.fromWebContents(event.sender) || win;
  ownerWindow?.webContents.setAudioMuted(false);
  win?.webContents.setAudioMuted(false);
  return getAudioDiagnostics(event.sender);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('before-quit', (event) => {
  // Graceful shutdown of the owned backend: SIGTERM → brief grace → SIGKILL.
  // In EXTERNAL mode the external backend is never touched.
  if (backendShutdownStarted || !backendLifecycle) return;
  backendShutdownStarted = true;
  event.preventDefault();
  logElectron('Shutting down backend via lifecycle manager...');
  void backendLifecycle.shutdown().finally(() => {
    logElectron('Backend shutdown complete.');
    app.exit(0);
  });
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logElectron('Another instance is already running. Quitting this instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logElectron('Second instance requested. Focusing existing window.');
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(true);
      }
    });
    
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media') {
        return true;
      }
      return true;
    });

    // ONE lifecycle manager owns backend truth in every mode. The window
    // shows immediately; the renderer renders the startup/offline state
    // from the manager's broadcast (no silent dead-backend UI).
    backendLifecycle = initBackendLifecycle();
    logElectron(`Backend lifecycle mode: ${BACKEND_MODE}`, { port: backendLifecycle.getState().port });
    createWindow();
    void backendLifecycle.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}
