import { BrowserWindow, app, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
var VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
var MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
var RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
var win;
var serverProcess = null;
function startBackendServer() {
	console.log("Starting backend server...");
	serverProcess = spawn("node", [path.join(process.env.APP_ROOT, "server", "dist", "index.js")], {
		cwd: path.join(process.env.APP_ROOT, "server"),
		stdio: "inherit"
	});
	serverProcess.on("error", (err) => {
		console.error("Failed to start server process:", err);
	});
}
function createWindow() {
	console.log("Creating main window...");
	win = new BrowserWindow({
		width: 1400,
		height: 900,
		title: "Agentic OS",
		icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
		frame: false,
		show: false,
		backgroundColor: "#0a0a0d",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true
		}
	});
	win.setMenuBarVisibility(false);
	win.once("ready-to-show", () => {
		console.log("Window ready-to-show triggered. Centering and showing...");
		win?.center();
		win?.show();
		console.log(`Window isVisible: ${win?.isVisible()}, Bounds: ${JSON.stringify(win?.getBounds())}`);
	});
	if (VITE_DEV_SERVER_URL) {
		console.log("Loading DEV server URL:", VITE_DEV_SERVER_URL);
		win.loadURL(VITE_DEV_SERVER_URL);
		win.webContents.openDevTools();
	} else win.loadFile(path.join(RENDERER_DIST, "index.html"));
}
ipcMain.on("window-minimize", () => win?.minimize());
ipcMain.on("window-maximize", () => {
	if (win?.isMaximized()) win?.unmaximize();
	else win?.maximize();
});
ipcMain.on("window-close", () => win?.close());
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
		win = null;
	}
});
app.on("quit", () => {
	if (serverProcess) {
		console.log("Killing backend server...");
		serverProcess.kill();
	}
});
app.whenReady().then(() => {
	startBackendServer();
	setTimeout(() => createWindow(), 1e3);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
//#endregion
export { MAIN_DIST, RENDERER_DIST, VITE_DEV_SERVER_URL };
