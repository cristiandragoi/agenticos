import { app, BrowserWindow, ipcMain, session, screen } from 'electron';
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

let win: BrowserWindow | null = null;
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

  // Authoritative production data location: app.getPath('userData')
  const userDataDir = app.getPath('userData');
  const canonicalDataDir = app.isPackaged
    ? path.join(userDataDir, 'data')
    : (process.env['AGENTICOS_DATA_DIR'] || path.join(appRoot, 'server', 'data'));
  const canonicalDbPath = path.join(canonicalDataDir, 'agentic-os.db');
  const legacyDataDir = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'data')
    : null;

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTICOS_DATA_DIR: canonicalDataDir,
    AGENT_TEAMS_DB_PATH: canonicalDbPath,
    AGENTICOS_USER_DATA_DIR: userDataDir,
    ...(legacyDataDir ? { AGENTICOS_LEGACY_DATA_DIR: legacyDataDir } : {}),
    AGENTICOS_IS_PACKAGED: app.isPackaged ? 'true' : 'false',
  };

  const manager = createBackendLifecycleManager({
    mode: BACKEND_MODE,
    host: '127.0.0.1',
    port,
    entry: path.join(backendRoot, 'server', 'dist', 'index.js'),
    cwd: path.join(backendRoot, 'server'),
    // The Electron binary itself runs the backend as plain Node — the
    // packaged app ships no separate node executable.
    nodeExec: process.execPath,
    env: backendEnv,
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
    logFile: path.join(app.isPackaged ? userDataDir : appRoot, '.agentos', 'logs', 'backend-managed.log'),
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

  let width = 1240;
  let height = 640;
  let x: number | undefined = undefined;
  let y: number | undefined = undefined;

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: workWidth, height: workHeight, x: workX, y: workY } = primaryDisplay.workArea;
    width = Math.min(1360, Math.max(960, workWidth - 40));
    height = Math.min(840, Math.max(580, workHeight - 30));
    x = workX + Math.max(0, Math.floor((workWidth - width) / 2));
    y = workY + Math.max(0, Math.floor((workHeight - height) / 2));
    logElectron('Calculated window bounds for primary display:', { width, height, x, y, workWidth, workHeight });
  } catch (err: any) {
    logElectron('Display bounds calculation error:', err?.message || String(err));
  }

  win = new BrowserWindow({
    width,
    height,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    minWidth: 800,
    minHeight: 500,
    title: 'Agentic OS',
    icon: path.join(process.env.VITE_PUBLIC, 'logo.jpg'),
    frame: false,
    show: true, // Always start visible so the window is never lost
    backgroundColor: '#0a0a0d', // Solid dark color to prevent Windows transparency bugs
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setAudioMuted(false);
  win.show();
  win.focus();
  logElectron('[AgenticOS Electron] BrowserWindow count after create', { count: BrowserWindow.getAllWindows().length });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logElectron('[AgenticOS Electron] render-process-gone', details);
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) {
      logElectron('[AgenticOS Electron] Recovering crashed renderer...');
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.reload();
        }
      }, 500);
    }
  });

  win.webContents.on('unresponsive', () => {
    logElectron('[AgenticOS Electron] Window became unresponsive.');
  });

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
    logElectron('Window ready-to-show triggered.');
    win?.webContents.setAudioMuted(false);
    win?.show();
    win?.focus();
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
ipcMain.on('window-close', () => {
  if (win && !win.isDestroyed()) {
    win.destroy();
    win = null;
  }
  app.quit();
});

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
ipcMain.handle('electron:get-identity', () => {
  // Load build identity from the resource tree at runtime
  let buildIdentity: Record<string, string | null> = { buildId: null, gitSha: null, buildTimestamp: null };
  try {
    const candidates = [
      path.join(app.isPackaged ? process.resourcesPath : process.env.APP_ROOT as string, 'server', 'dist', 'build-identity.json'),
      path.join(process.env.APP_ROOT as string, 'server', 'dist', 'build-identity.json'),
      path.join(process.env.APP_ROOT as string, 'server', 'src', 'build-identity.json'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        buildIdentity = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        break;
      }
    }
  } catch { /* best-effort */ }

  return {
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    appName: app.getName(),
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
    exePath: process.execPath,
    resourcesPath: (process as any).resourcesPath ?? null,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    buildId: buildIdentity.buildId ?? null,
    gitSha: buildIdentity.gitSha ?? null,
    buildTimestamp: buildIdentity.buildTimestamp ?? null,
  };
});

function getAudioDiagnostics(webContents = win?.webContents) {
  const ownerWindow = webContents ? BrowserWindow.fromWebContents(webContents) : win;
  const inspectedContents = webContents || ownerWindow?.webContents || null;
  return {
    isOwnerWindowMuted: ownerWindow?.webContents.isAudioMuted() ?? null,
    isWebContentsMuted: inspectedContents?.isAudioMuted() ?? null,
    isAppSuspended: (app as any).isSuspended?.() ?? null,
    browserWindowCount: BrowserWindow.getAllWindows().length,
  };
}

ipcMain.handle('voice:get-audio-diagnostics', (event) => getAudioDiagnostics(event.sender));

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
  const forceExit = setTimeout(() => {
    logElectron('Backend shutdown timed out, forcing exit.');
    app.exit(0);
  }, 2500);
  void backendLifecycle.shutdown().finally(() => {
    clearTimeout(forceExit);
    logElectron('Backend shutdown complete.');
    app.exit(0);
  });
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logElectron('Another instance is already running. Quitting this instance immediately.');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    logElectron('Second instance requested. Focusing or creating window.');
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.moveTop();
    } else {
      createWindow();
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
