import { BrowserWindow as e, app as t, ipcMain as n, session as r } from "electron";
import { fileURLToPath as i } from "node:url";
import a from "node:path";
import { spawn as o } from "node:child_process";
t.commandLine.appendSwitch("disable-gpu"), t.commandLine.appendSwitch("disable-software-rasterizer"), t.commandLine.appendSwitch("disable-gpu-sandbox");
var s = a.dirname(i(import.meta.url));
process.env.APP_ROOT = a.join(s, ".."), process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
var c = process.env.VITE_DEV_SERVER_URL, l = a.join(process.env.APP_ROOT, "dist-electron"), u = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = c ? a.join(process.env.APP_ROOT, "public") : u;
var d, f = null;
function p() {
	console.log("Starting backend server..."), f = o("node", [a.join(process.env.APP_ROOT, "server", "dist", "index.js")], {
		cwd: a.join(process.env.APP_ROOT, "server"),
		stdio: "inherit"
	}), f.on("error", (e) => {
		console.error("Failed to start server process:", e);
	});
}
function m() {
	console.log("Creating main window..."), d = new e({
		width: 1400,
		height: 900,
		title: "Agentic OS",
		icon: a.join(process.env.VITE_PUBLIC, "logo.jpg"),
		frame: !1,
		show: !1,
		backgroundColor: "#0a0a0d",
		webPreferences: {
			preload: a.join(s, "preload.cjs"),
			nodeIntegration: !1,
			contextIsolation: !0
		}
	}), d.setMenuBarVisibility(!1), d.once("ready-to-show", () => {
		console.log("Window ready-to-show triggered. Centering and showing..."), d?.center(), d?.show(), console.log(`Window isVisible: ${d?.isVisible()}, Bounds: ${JSON.stringify(d?.getBounds())}`);
	}), c ? (console.log("Loading DEV server URL:", c), d.loadURL(c + "#/mission-control"), d.webContents.openDevTools()) : d.loadFile(a.join(u, "index.html"), { hash: "/mission-control" });
}
n.on("window-minimize", () => d?.minimize()), n.on("window-maximize", () => {
	d?.isMaximized() ? d?.unmaximize() : d?.maximize();
}), n.on("window-close", () => d?.close()), t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), d = null);
}), t.on("quit", () => {
	f && (console.log("Killing backend server..."), f.kill());
}), t.whenReady().then(() => {
	r.defaultSession.setPermissionRequestHandler((e, t, n) => {
		n(!0);
	}), r.defaultSession.setPermissionCheckHandler((e, t) => !0), p(), setTimeout(() => m(), 1e3), t.on("activate", () => {
		e.getAllWindows().length === 0 && m();
	});
});
//#endregion
export { l as MAIN_DIST, u as RENDERER_DIST, c as VITE_DEV_SERVER_URL };
