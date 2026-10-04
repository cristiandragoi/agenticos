import { app, BrowserWindow, ipcMain, session, screen, Menu, shell } from 'electron';
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
import { resolveSingleInstanceConflict } from './processOwnership';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const ELECTRON_RENDERER_ROUTE = process.env['AGENTICOS_ELECTRON_ROUTE'] || '#/jarvis';
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

logElectron('[STARTUP] APP_START', { pid: process.pid, execPath: process.execPath, argv: process.argv });

function getHwndString(targetWin: BrowserWindow | null): string | null {
  if (!targetWin || targetWin.isDestroyed()) return null;
  try {
    const handleBuf = targetWin.getNativeWindowHandle();
    if (process.platform === 'win32') {
      const hwndBig = handleBuf.readBigInt64LE(0);
      return `0x${hwndBig.toString(16)}`;
    }
    return `0x${handleBuf.readInt32LE(0).toString(16)}`;
  } catch {
    return null;
  }
}

function ensureWindowOnVisibleDisplay(bounds: { x?: number; y?: number; width?: number; height?: number }): { x: number; y: number; width: number; height: number } {
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const primaryWork = primary.workArea;

    let width = bounds.width || 1240;
    let height = bounds.height || 640;
    width = Math.min(1360, Math.max(960, Math.min(width, primaryWork.width - 40)));
    height = Math.min(840, Math.max(580, Math.min(height, primaryWork.height - 30)));

    if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
      const x = primaryWork.x + Math.max(0, Math.floor((primaryWork.width - width) / 2));
      const y = primaryWork.y + Math.max(0, Math.floor((primaryWork.height - height) / 2));
      return { x, y, width, height };
    }

    const intersects = displays.some((d) => {
      const wa = d.workArea;
      return (
        bounds.x! < wa.x + wa.width &&
        bounds.x! + width > wa.x &&
        bounds.y! < wa.y + wa.height &&
        bounds.y! + height > wa.y
      );
    });

    if (!intersects || width < 100 || height < 100) {
      const x = primaryWork.x + Math.max(0, Math.floor((primaryWork.width - width) / 2));
      const y = primaryWork.y + Math.max(0, Math.floor((primaryWork.height - height) / 2));
      return { x, y, width, height };
    }

    return { x: bounds.x, y: bounds.y, width, height };
  } catch {
    return { x: 100, y: 100, width: 1240, height: 640 };
  }
}

function updateDesktopRuntime(updates?: Partial<{
  rendererLoaded: boolean;
  rendererResponsive: boolean;
}>): void {
  try {
    const userDataDir = app.getPath('userData');
    const runtimePath = path.join(userDataDir, 'desktop-runtime.json');
    const hwnd = getHwndString(win);
    const exists = win && !win.isDestroyed();
    const isVisible = exists ? win.isVisible() : false;
    const bounds = exists ? win.getBounds() : null;
    const title = exists ? win.getTitle() : 'AgenticOS';
    const isHealthyBackend = backendLifecycle?.getState().status === 'healthy';
    const isLoaded = updates?.rendererLoaded ?? false;

    const state = {
      processRunning: true,
      backendHealthy: isHealthyBackend,
      mainWindowExists: Boolean(exists),
      mainWindowVisible: Boolean(isVisible),
      rendererLoaded: isLoaded,
      rendererResponsive: updates?.rendererResponsive ?? isLoaded,
      hwnd: hwnd || null,
      windowTitle: title,
      bounds: bounds || null,
      pid: process.pid,
      desktopReady: Boolean(exists && isVisible && isLoaded),
      status: (exists && isVisible && isLoaded) ? 'DESKTOP_READY' : 'BACKEND_HEALTHY',
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${runtimePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, runtimePath);
  } catch {
    // Best-effort write
  }
}


/**
 * Build the backend lifecycle manager. Paths resolve from the Electron
 * app root (repo root in dev, packaged resources in production — the
 * electron-builder `files` list ships server/dist + server/node_modules
 * next to dist-electron), never from the shell working directory.
 */
function initBackendLifecycle(): BackendLifecycleManager {
  const appRoot = process.env.APP_ROOT as string;
  const isInstalledApp = app.isPackaged || !process.defaultApp || path.basename(process.execPath).toLowerCase().startsWith('agenticos');
  // Packaged / installed mode: the backend runtime ships under resources/server (via
  // electron-builder extraResources), NOT inside resources/app — native
  // node_modules must live outside the app dir. Dev mode: repo root.
  const backendRoot = isInstalledApp ? process.resourcesPath : appRoot;
  const port = process.env['AGENTICOS_BACKEND_PORT']
    ? parseInt(process.env['AGENTICOS_BACKEND_PORT'], 10)
    : readPortFromServerEnv(backendRoot, 4600);

  // Authoritative production data location: app.getPath('userData')
  const userDataDir = app.getPath('userData');
  const canonicalDataDir = isInstalledApp
    ? path.join(userDataDir, 'data')
    : (process.env['AGENTICOS_DATA_DIR'] || path.join(appRoot, 'server', 'data'));
  const canonicalDbPath = path.join(canonicalDataDir, 'agentic-os.db');
  const legacyDataDir = isInstalledApp
    ? path.join(process.resourcesPath, 'server', 'data')
    : null;

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    AGENTICOS_BACKEND_PORT: String(port),
    AGENTICOS_DATA_DIR: canonicalDataDir,
    AGENT_TEAMS_DB_PATH: canonicalDbPath,
    AGENTICOS_USER_DATA_DIR: userDataDir,
    ...(legacyDataDir ? { AGENTICOS_LEGACY_DATA_DIR: legacyDataDir } : {}),
    AGENTICOS_IS_PACKAGED: isInstalledApp ? 'true' : 'false',
  };

  let buildIdentity: { buildId?: string | null; gitSha?: string | null; buildTimestamp?: string | null } = {};
  try {
    const candidates = [
      path.join(isInstalledApp ? process.resourcesPath : appRoot, 'server', 'dist', 'build-identity.json'),
      path.join(appRoot, 'server', 'dist', 'build-identity.json'),
      path.join(appRoot, 'server', 'src', 'build-identity.json'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        buildIdentity = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        break;
      }
    }
  } catch { /* best-effort */ }

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
    healthProbeTimeoutMs: 5000,
    readinessPollMs: 1000,
    // Observed cold boot is ~20s (migrations + gateway checks); allow room
    // while still failing clearly when readiness never arrives.
    readyTimeoutMs: 60000,
    healthIntervalMs: 5000,
    maxRestarts: 3,
    backoffMs: [1000, 3000, 8000],
    crashThreshold: 3,
    crashWindowMs: 60000,
    unhealthyTolerance: 4,
    logFile: path.join(isInstalledApp ? userDataDir : appRoot, '.agentos', 'logs', 'backend-managed.log'),
    userDataDir,
    buildIdentity,
  }, {
    probe: httpHealthProbe,
    spawnBackend: spawnBackendWithElectronNode,
    log: (message) => logElectron(message),
  });
  manager.onStateChange((state) => {
    if (state.status === 'healthy') {
      logElectron('[STARTUP] BACKEND_HEALTHY', { port: state.port, pid: state.pid });
      updateDesktopRuntime();
    }
    for (const window of BrowserWindow.getAllWindows()) {
      try { window.webContents.send('backend-lifecycle:state', state); } catch { /* window closing */ }
    }
  });
  return manager;

}

function resolveAppIcon(): string {
  const appRoot = process.env.APP_ROOT || path.join(__dirname, '..');
  const candidates = [
    path.join(appRoot, 'build', 'icons', 'agenticos.ico'),
    path.join(process.resourcesPath, 'build', 'icons', 'agenticos.ico'),
    path.join(process.resourcesPath, 'app', 'build', 'icons', 'agenticos.ico'),
    path.join(appRoot, 'build', 'icons', 'agenticos.png'),
    path.join(process.resourcesPath, 'build', 'icons', 'agenticos.png'),
    path.join(process.env.VITE_PUBLIC || path.join(appRoot, 'public'), 'logo.png'),
    path.join(process.resourcesPath, 'public', 'logo.png'),
    path.join(process.resourcesPath, 'app', 'public', 'logo.png'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.join(appRoot, 'public', 'logo.png');
}

function createWindow() {
  logElectron('[STARTUP] WINDOW_CREATE_STARTED');

  try {
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
      const valid = ensureWindowOnVisibleDisplay({ width, height, x, y });
      width = valid.width;
      height = valid.height;
      x = valid.x;
      y = valid.y;
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
      title: 'AgenticOS',
      icon: resolveAppIcon(),
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

    const hwnd = getHwndString(win);
    logElectron('[STARTUP] WINDOW_CREATED', { hwnd, bounds: win.getBounds() });
    updateDesktopRuntime({ rendererLoaded: false, rendererResponsive: false });

    Menu.setApplicationMenu(null);
    win.setAutoHideMenuBar(true);
    win.setMenuBarVisibility(false);
    win.webContents.setAudioMuted(false);

    // Global right-click context menu: editable fields get Cut/Copy/Paste/Select All,
    // selected text gets Copy/Select All. (App menu is disabled, so this is the only
    // way to reach clipboard operations.)
    win.webContents.on('context-menu', (_event, params) => {
      const template: Parameters<typeof Menu.buildFromTemplate>[0] = [];
      if (params.isEditable) {
        template.push(
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        );
      } else if (params.selectionText && params.selectionText.trim().length > 0) {
        template.push(
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'selectAll' },
        );
      }
      if (template.length > 0) {
        Menu.buildFromTemplate(template).popup({ window: win ?? undefined });
      }
    });

    // Enforce single-shell: intercept any attempts to open new windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      logElectron('[AgenticOS Electron] Window open intercepted (enforcing single-shell):', { url });
      // Internal routes or localhost hash routes navigate in current window
      if (url.includes('#/') || url.includes('localhost') || url.includes('127.0.0.1')) {
        const hashIdx = url.indexOf('#');
        if (hashIdx !== -1 && win && !win.isDestroyed()) {
          const route = url.slice(hashIdx + 1);
          win.webContents.send('agenticos:navigate', route);
        }
        return { action: 'deny' };
      }
      // External URLs open in system browser
      shell.openExternal(url);
      return { action: 'deny' };
    });

    win.show();
    win.focus();
    logElectron('[AgenticOS Electron] BrowserWindow count after create', { count: BrowserWindow.getAllWindows().length });

    win.on('closed', () => {
      win = null;
      updateDesktopRuntime({ rendererLoaded: false, rendererResponsive: false });
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      logElectron('[STARTUP_FAILURE] RENDER_PROCESS_GONE', details);
      if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) {
        logElectron('[AgenticOS Electron] Recovering crashed renderer...');
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            win.reload();
          }
        }, 500);
      }
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      logElectron('[STARTUP_FAILURE] DID_FAIL_LOAD', { errorCode, errorDescription, validatedURL });
    });

    win.webContents.on('unresponsive', () => {
      logElectron('[STARTUP_FAILURE] UNRESPONSIVE');
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
      logElectron('[STARTUP] RENDERER_LOAD_FINISHED', {
        loadedUrl,
        rendererInfo,
        browserWindowCount: BrowserWindow.getAllWindows().length
      });
      updateDesktopRuntime({ rendererLoaded: true, rendererResponsive: true });
    });

    win.webContents.on('did-navigate-in-page', (_event, url) => {
      logElectron('[AgenticOS Electron] did-navigate-in-page', { url });
    });

    win.once('ready-to-show', () => {
      logElectron('[STARTUP] READY_TO_SHOW');
      win?.webContents.setAudioMuted(false);
      win?.show();
      win?.focus();
      const isVisible = win?.isVisible();
      const bounds = win?.getBounds();
      const currentHwnd = getHwndString(win);
      logElectron('[STARTUP] WINDOW_VISIBLE', { isVisible, bounds, hwnd: currentHwnd });
      updateDesktopRuntime({ rendererLoaded: true, rendererResponsive: true });
    });

    if (VITE_DEV_SERVER_URL) {
      const targetUrl = `${VITE_DEV_SERVER_URL}${ELECTRON_RENDERER_ROUTE}`;
      logElectron('[STARTUP] RENDERER_LOAD_STARTED', { targetUrl, isDev: true });
      logElectron('[AgenticOS Electron] Vite URL', { viteUrl: VITE_DEV_SERVER_URL });
      logElectron('[AgenticOS Electron] Renderer route', { route: ELECTRON_RENDERER_ROUTE });
      win.loadURL(targetUrl);
      if (process.env.AGENTICOS_OPEN_DEVTOOLS === '1' || process.env.AGENTICOS_OPEN_DEVTOOLS === 'true') {
        win.webContents.openDevTools();
      }
    } else {
      const prodPath = path.join(RENDERER_DIST, 'index.html');
      logElectron('[STARTUP] RENDERER_LOAD_STARTED', { prodPath, isDev: false });
      win.loadFile(prodPath, { hash: '/jarvis' });
    }

    // Manual DevTools shortcut support (F12 or Ctrl+Shift+I / Cmd+Option+I)
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isF12 = input.key === 'F12';
      const isDevToolsCombo = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
      if (isF12 || isDevToolsCombo) {
        win?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  } catch (err: any) {
    logElectron('[STARTUP_FAILURE] WINDOW_CREATE_FAILED', {
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
    throw err;
  }
}


// Window control IPCs
ipcMain.on('window-toggle-devtools', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.toggleDevTools();
  }
});
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
ipcMain.handle('watchdog:get-state', () => {
  const lifecycleState = backendLifecycle?.getState();
  return {
    watchdogPhase: lifecycleState?.watchdogPhase ?? 'STARTING',
    watchdogEvidence: lifecycleState?.watchdogEvidence ?? null,
    backendStatus: lifecycleState?.status ?? 'starting',
    port: lifecycleState?.port ?? 4600,
    pid: lifecycleState?.pid ?? null,
    owned: lifecycleState?.owned ?? false,
  };
});
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

const isInstalledApp = app.isPackaged || !process.defaultApp || path.basename(process.execPath).toLowerCase().startsWith('agenticos');
if (isInstalledApp) {
  app.setName('AgenticOS');
  app.setPath('userData', path.join(app.getPath('appData'), 'AgenticOS'));
} else {
  app.setName('AgenticOS-dev');
  app.setPath('userData', path.join(app.getPath('appData'), 'AgenticOS-dev'));
}

logElectron(`userData initialized: ${app.getPath('userData')} (isPackaged=${app.isPackaged}, isInstalledApp=${isInstalledApp})`);

logElectron('[watchdog] Phase: CHECKING_EXISTING_INSTANCE');
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logElectron('[watchdog] requestSingleInstanceLock returned false — investigating instance ownership...');
  const resolution = resolveSingleInstanceConflict({
    execPath: process.execPath,
    currentPid: process.pid,
    userDataDir: app.getPath('userData'),
    log: (msg) => logElectron(msg),
  });

  if (resolution.action === 'RELAUNCHED_AFTER_STALE_CLEANUP') {
    logElectron('[watchdog] Stale instance ownership recovered. Scheduling clean relaunch of AgenticOS...', resolution.evidence);
    app.relaunch();
    app.exit(0);
  } else {
    logElectron('[watchdog] Verified healthy AgenticOS instance is already running. Exiting secondary launcher.', resolution.evidence);
    app.exit(0);
  }
} else {
  logElectron('[STARTUP] SINGLE_INSTANCE_LOCK_ACQUIRED');
  logElectron('[watchdog] Single-instance lock acquired successfully. Primary instance established.');

  app.on('second-instance', () => {
    logElectron('[AgenticOS Electron] Second instance requested. Focusing or creating window.');
    if (win && !win.isDestroyed()) {
      try {
        const b = win.getBounds();
        const valid = ensureWindowOnVisibleDisplay(b);
        win.setBounds(valid);
      } catch {}
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
      win.moveTop();
      updateDesktopRuntime({ rendererLoaded: true, rendererResponsive: true });
    } else {
      createWindow();
    }
  });

  app.on('child-process-gone', (_event, details) => {
    logElectron('[STARTUP_FAILURE] CHILD_PROCESS_GONE', details);
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.agenticos.desktop');
    }
    const isTrustedOrigin = (originUrl?: string): boolean => {
      if (!originUrl) return true;
      try {
        const parsed = new URL(originUrl);
        return (
          parsed.protocol === 'file:' ||
          ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'))
        );
      } catch {
        return (
          originUrl.startsWith('file://') ||
          originUrl.startsWith('http://127.0.0.1') ||
          originUrl.startsWith('http://localhost')
        );
      }
    };

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = details?.requestingUrl || (webContents && webContents.getURL?.());
      const trusted = isTrustedOrigin(requestingUrl);
      if (
        trusted &&
        (permission === 'media' ||
          (permission as string) === 'audioCapture' ||
          (permission as string) === 'microphone' ||
          permission === 'notifications')
      ) {
        logElectron('[AgenticOS Electron] Permission granted for trusted origin:', { permission, requestingUrl });
        callback(true);
      } else {
        logElectron('[AgenticOS Electron] Permission denied:', { permission, requestingUrl, trusted });
        callback(false);
      }
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const trusted = isTrustedOrigin(requestingOrigin || (webContents && webContents.getURL?.()));
      if (
        trusted &&
        (permission === 'media' ||
          (permission as string) === 'audioCapture' ||
          (permission as string) === 'microphone' ||
          permission === 'notifications')
      ) {
        return true;
      }
      return false;
    });

    session.defaultSession.setDevicePermissionHandler((details) => {
      const origin = details?.origin;
      return isTrustedOrigin(origin);
    });

    // ONE lifecycle manager owns backend truth in every mode. The window
    // shows immediately; the renderer renders the startup/offline state
    // from the manager's broadcast (no silent dead-backend UI).
    backendLifecycle = initBackendLifecycle();
    logElectron('[STARTUP] BACKEND_START_REQUESTED', { mode: BACKEND_MODE, port: backendLifecycle.getState().port });
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
