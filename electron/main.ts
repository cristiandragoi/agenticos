import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

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
const USE_EXTERNAL_SERVERS = process.env['AGENTICOS_EXTERNAL_SERVERS'] === 'true';
const ELECTRON_RENDERER_ROUTE = process.env['AGENTICOS_ELECTRON_ROUTE'] || '#/mission-control';
const REMOTE_DEBUGGING_PORT = process.env['AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT'];

if (REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUGGING_PORT);
  console.log(`[AgenticOS Electron] Remote debugging port: ${REMOTE_DEBUGGING_PORT}`);
}

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;
let serverProcess: ReturnType<typeof spawn> | null = null;

function logElectron(message: string, data?: unknown) {
  const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`;
  console.log(line);
  const logFile = process.env['AGENTICOS_ELECTRON_LOG'] ||
    path.join(process.env.APP_ROOT || path.join(__dirname, '..'), '.agentos', 'logs', 'electron-dev.log');
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

function startBackendServer() {
  logElectron('Starting backend server...');
  const serverPath = path.join(process.env.APP_ROOT, 'server', 'dist', 'index.js');
  
  serverProcess = spawn('node', [serverPath], {
    cwd: path.join(process.env.APP_ROOT, 'server'),
    env: process.env,
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    logElectron('Failed to start server process:', { error: err.message });
  });
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

app.on('quit', () => {
  if (serverProcess) {
    logElectron('Killing backend server...');
    serverProcess.kill();
  }
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

    if (USE_EXTERNAL_SERVERS) {
      logElectron('Using external AgenticOS backend/Vite servers. Electron will not spawn a backend.');
      createWindow();
    } else {
      startBackendServer();
      setTimeout(() => createWindow(), 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}
