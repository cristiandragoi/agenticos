import { BrowserWindow as e, app as t, ipcMain as n, session as r } from "electron";
import { fileURLToPath as i } from "node:url";
import a from "node:path";
import { spawn as o } from "node:child_process";
import s from "node:fs";
t.commandLine.appendSwitch("disable-gpu"), t.commandLine.appendSwitch("disable-software-rasterizer"), t.commandLine.appendSwitch("disable-gpu-sandbox"), t.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
var c = a.dirname(i(import.meta.url));
process.env.APP_ROOT = a.join(c, ".."), process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
var l = process.env.VITE_DEV_SERVER_URL, u = a.join(process.env.APP_ROOT, "dist-electron"), d = a.join(process.env.APP_ROOT, "dist"), f = process.env.AGENTICOS_EXTERNAL_SERVERS === "true", p = process.env.AGENTICOS_ELECTRON_ROUTE || "#/mission-control", m = process.env.AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT;
m && (t.commandLine.appendSwitch("remote-debugging-port", m), console.log(`[AgenticOS Electron] Remote debugging port: ${m}`)), process.env.VITE_PUBLIC = l ? a.join(process.env.APP_ROOT, "public") : d;
var h, g = null;
function _(e, t) {
	let n = t === void 0 ? e : `${e} ${JSON.stringify(t)}`;
	console.log(n);
	let r = process.env.AGENTICOS_ELECTRON_LOG || a.join(process.env.APP_ROOT || a.join(c, ".."), ".agentos", "logs", "electron-dev.log");
	if (r) try {
		s.mkdirSync(a.dirname(r), { recursive: !0 }), s.appendFileSync(r, `${(/* @__PURE__ */ new Date()).toISOString()} ${n}\n`, "utf8");
	} catch {}
}
function v() {
	_("Starting backend server..."), g = o("node", [a.join(process.env.APP_ROOT, "server", "dist", "index.js")], {
		cwd: a.join(process.env.APP_ROOT, "server"),
		env: process.env,
		stdio: "inherit"
	}), g.on("error", (e) => {
		_("Failed to start server process:", { error: e.message });
	});
}
function y() {
	if (_("Creating main window..."), h = new e({
		width: 1400,
		height: 900,
		title: "Agentic OS",
		icon: a.join(process.env.VITE_PUBLIC, "logo.jpg"),
		frame: !1,
		show: !1,
		backgroundColor: "#0a0a0d",
		webPreferences: {
			preload: a.join(c, "preload.cjs"),
			nodeIntegration: !1,
			contextIsolation: !0
		}
	}), h.setMenuBarVisibility(!1), h.webContents.setAudioMuted(!1), _("[AgenticOS Electron] BrowserWindow count after create", { count: e.getAllWindows().length }), h.webContents.on("console-message", (e, t, n, r, i) => {
		_("[AgenticOS Renderer console]", {
			level: t,
			message: n,
			line: r,
			sourceId: i
		});
	}), h.webContents.on("did-finish-load", async () => {
		let t = h?.webContents.getURL() || "unknown", n = {};
		try {
			n = await h?.webContents.executeJavaScript("({\n        href: window.location.href,\n        buildId: window.__AGENTICOS_RENDERER_BUILD_ID || null,\n        buildTimestamp: window.__AGENTICOS_RENDERER_BUILD_TIMESTAMP || null,\n        voiceControllerInstanceId: document.querySelector('[data-testid=\"jarvis-voice-diagnostics\"]')?.textContent?.match(/voiceControllerInstanceId:\\s*([^\\n]+)/)?.[1]?.trim() || null\n      })");
		} catch (e) {
			n = { error: e?.message || String(e) };
		}
		_("[AgenticOS Electron] did-finish-load", {
			loadedUrl: t,
			rendererInfo: n,
			browserWindowCount: e.getAllWindows().length
		});
	}), h.webContents.on("did-navigate-in-page", (e, t) => {
		_("[AgenticOS Electron] did-navigate-in-page", { url: t });
	}), h.once("ready-to-show", () => {
		_("Window ready-to-show triggered. Centering and showing..."), h?.webContents.setAudioMuted(!1), h?.center(), h?.show(), _("[AgenticOS Electron] Window visible state", {
			isVisible: h?.isVisible(),
			bounds: h?.getBounds()
		});
	}), l) {
		let e = `${l}${p}`;
		_("[AgenticOS Electron] Loading DEV server URL", { targetUrl: e }), _("[AgenticOS Electron] Vite URL", { viteUrl: l }), _("[AgenticOS Electron] Renderer route", { route: p }), _("[AgenticOS Electron] Renderer build env", {
			buildId: process.env.VITE_AGENTICOS_BUILD_ID || process.env.AGENTICOS_RENDERER_BUILD_ID || "unknown",
			buildTimestamp: process.env.VITE_AGENTICOS_BUILD_TIMESTAMP || process.env.AGENTICOS_RENDERER_BUILD_TIMESTAMP || "unknown"
		}), h.loadURL(e), h.webContents.openDevTools();
	} else h.loadFile(a.join(d, "index.html"), { hash: "/mission-control" });
}
n.on("window-minimize", () => h?.minimize()), n.on("window-maximize", () => {
	h?.isMaximized() ? h?.unmaximize() : h?.maximize();
}), n.on("window-close", () => h?.close()), n.on("agenticos:renderer-diagnostics", (t, n) => {
	_("[AgenticOS Electron] renderer-diagnostics", {
		payload: n,
		webContentsUrl: h?.webContents.getURL() || null,
		browserWindowCount: e.getAllWindows().length
	});
});
function b(t = h?.webContents) {
	let n = t ? e.fromWebContents(t) : h, r = t || n?.webContents || null;
	return {
		electronAvailable: !0,
		webContentsAudioMuted: r ? r.isAudioMuted() : null,
		browserWindowAudioMuted: n?.webContents ? n.webContents.isAudioMuted() : null,
		sessionPartition: r?.session?.partition || "default",
		mediaPermissionPolicy: "defaultSession allows media permission requests and checks",
		autoplayPolicy: "no-user-gesture-required",
		windowsAppMuteState: "not directly accessible from Electron main process"
	};
}
n.handle("voice:get-audio-diagnostics", (e) => b(e.sender)), n.handle("voice:ensure-audio-unmuted", (t) => (t.sender.setAudioMuted(!1), (e.fromWebContents(t.sender) || h)?.webContents.setAudioMuted(!1), h?.webContents.setAudioMuted(!1), b(t.sender))), t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), h = null);
}), t.on("quit", () => {
	g && (_("Killing backend server..."), g.kill());
}), t.requestSingleInstanceLock() ? (t.on("second-instance", () => {
	_("Second instance requested. Focusing existing window."), h && (h.isMinimized() && h.restore(), h.focus());
}), t.whenReady().then(() => {
	r.defaultSession.setPermissionRequestHandler((e, t, n) => {
		n(!0);
	}), r.defaultSession.setPermissionCheckHandler((e, t) => !0), f ? (_("Using external AgenticOS backend/Vite servers. Electron will not spawn a backend."), y()) : (v(), setTimeout(() => y(), 1e3)), t.on("activate", () => {
		e.getAllWindows().length === 0 && y();
	});
})) : (_("Another instance is already running. Quitting this instance."), t.quit());
//#endregion
export { u as MAIN_DIST, d as RENDERER_DIST, l as VITE_DEV_SERVER_URL };
