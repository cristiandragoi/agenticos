import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;
let serverProcess: ReturnType<typeof spawn> | null = null;

function startBackendServer() {
  console.log('Starting backend server...');
  const serverPath = path.join(process.env.APP_ROOT, 'server', 'dist', 'index.js');
  
  serverProcess = spawn('node', [serverPath], {
    cwd: path.join(process.env.APP_ROOT, 'server'),
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server process:', err);
  });
}

function createWindow() {
  console.log('Creating main window...');
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

  win.once('ready-to-show', () => {
    console.log('Window ready-to-show triggered. Centering and showing...');
    win?.center();
    win?.show();
    console.log(`Window isVisible: ${win?.isVisible()}, Bounds: ${JSON.stringify(win?.getBounds())}`);
  });

  if (VITE_DEV_SERVER_URL) {
    console.log('Loading DEV server URL:', VITE_DEV_SERVER_URL);
    win.loadURL(VITE_DEV_SERVER_URL + '#/mission-control');
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('quit', () => {
  if (serverProcess) {
    console.log('Killing backend server...');
    serverProcess.kill();
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

  startBackendServer();
  setTimeout(() => createWindow(), 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
