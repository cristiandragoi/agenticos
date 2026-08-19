import { BrowserWindow as e, app as t, ipcMain as n, screen as r, session as i } from "electron";
import { fileURLToPath as a } from "node:url";
import o from "node:path";
import s from "node:fs";
import { execFileSync as c, spawn as l } from "node:child_process";
//#region electron/backendLifecycle.ts
var u = 500;
function d(e) {
	return e.replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]").replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+\b/g, "[REDACTED_JWT]").replace(/([A-Za-z0-9_\-]*authorization\b\s*[:=]\s*)([^\n]+)/gi, (e, t, n) => /^Bearer\s/i.test(n) ? e : `${t}[REDACTED]`).replace(/([A-Za-z0-9_\-]*(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|secret|auth[_-]?token|token|password|passwd|private[_-]?key)\b)(\s*[:=]\s*)([^\s'",]+)/gi, (e, t, n) => `${t}${n}[REDACTED]`);
}
function f(e) {
	return {
		mode: e.mode,
		status: "starting",
		backendUrl: `http://${e.host}:${e.port}`,
		port: e.port,
		pid: null,
		owned: !1,
		startedAt: null,
		lastHealthSuccessAt: null,
		lastHealthFailureAt: null,
		restartCount: 0,
		lastError: null,
		readinessMs: null,
		recentLog: []
	};
}
function p(e, t) {
	let n = t.now ?? (() => Date.now()), r = t.setTimeout ?? ((e, t) => setTimeout(e, t)), i = t.clearTimeout ?? ((e) => clearTimeout(e)), a = t.setInterval ?? ((e, t) => setInterval(e, t)), l = t.clearInterval ?? ((e) => clearInterval(e)), p = t.log ?? (() => {}), m = f(e), h = /* @__PURE__ */ new Set(), g = null, _ = !1, v = !1, y = !1, b = null, x = null, S = null, C = null, w = 0, T = [], E = !1, D = `${m.backendUrl}${e.healthPath}`;
	function O(e) {
		m = {
			...m,
			...e
		};
		for (let e of h) try {
			e(m);
		} catch {}
	}
	function k(t, r) {
		for (let i of t.split(/\r?\n/)) {
			if (!i.trim()) continue;
			let t = d(i).slice(0, u), a = [...m.recentLog, `[${r}] ${t}`].slice(-80);
			m = {
				...m,
				recentLog: a
			};
			try {
				e.logFile && (s.mkdirSync(o.dirname(e.logFile), { recursive: !0 }), s.appendFileSync(e.logFile, `${new Date(n()).toISOString()} [backend:${r}] ${t}\n`, "utf8"));
			} catch {}
			p(`[backend:${r}] ${t}`);
		}
	}
	function A() {
		x !== null && (l(x), x = null), S !== null && (l(S), S = null);
	}
	function j() {
		S !== null && (l(S), S = null), x === null && (x = a(() => {
			H();
		}, e.healthIntervalMs));
	}
	async function M() {
		try {
			return await t.probe(D, e.healthProbeTimeoutMs);
		} catch (e) {
			return {
				reachable: !1,
				healthy: !1,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	function N(e) {
		return e.healthy ? "healthy" : e.reachable ? `reachable but unhealthy${e.httpStatus ? ` (HTTP ${e.httpStatus})` : ""}${e.error ? ` — ${e.error}` : ""}` : e.error || "unreachable";
	}
	function P() {
		if (!g) return;
		let e = g;
		if (e.pid && process.platform === "win32") try {
			c("taskkill", [
				"/F",
				"/T",
				"/PID",
				String(e.pid)
			], {
				windowsHide: !0,
				stdio: "ignore"
			});
		} catch {}
		try {
			e.kill();
		} catch {}
	}
	function F(t, r) {
		let a = g;
		if (g = null, O({ pid: null }), v) {
			O({
				status: "offline",
				lastError: null
			});
			return;
		}
		if (!a) return;
		if (y) {
			y = !1;
			return;
		}
		let o = E;
		if (E = !1, b !== null && (i(b), b = null), k(`process exited (code=${t ?? "null"}, signal=${r ?? "null"})`, "stderr"), O({ lastHealthFailureAt: n() }), o) {
			T = [], O({
				status: "reconnecting",
				restartCount: 0,
				lastError: null
			}), L(0);
			return;
		}
		if (T.push(n()), T = T.filter((t) => n() - t <= e.crashWindowMs), T.length >= e.crashThreshold) {
			let t = m.recentLog.slice(-6).join(" | ");
			I(`Backend crashed ${T.length} times within ${Math.round(e.crashWindowMs / 1e3)}s — automatic restart stopped. Last output: ${t || "(no output captured)"}`);
			return;
		}
		if (m.restartCount >= e.maxRestarts) {
			I(`Restart budget exhausted (${e.maxRestarts} attempts). Last exit: code=${t ?? "null"}, signal=${r ?? "null"}.`);
			return;
		}
		let s = m.restartCount + 1, c = e.backoffMs[Math.min(s - 1, e.backoffMs.length - 1)] ?? 1e3;
		O({
			status: "reconnecting",
			restartCount: s,
			lastError: `Backend exited unexpectedly (code=${t ?? "null"}). Restart ${s}/${e.maxRestarts} in ${Math.round(c / 1e3)}s.`
		}), L(c);
	}
	function I(t) {
		A(), b !== null && (i(b), b = null), O({
			status: "failed",
			lastError: t
		}), p(`[lifecycle] FAILED: ${t}`), S === null && (S = a(() => {
			U();
		}, e.healthIntervalMs * 5));
	}
	function L(e) {
		C !== null && i(C), C = r(() => {
			C = null, R();
		}, e);
	}
	async function R() {
		if (_ || v || g) return;
		_ = !0;
		let r;
		try {
			r = t.spawnBackend(e);
		} catch (e) {
			_ = !1, I(`Could not start the backend process: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		_ = !1, g = r, O({
			pid: r.pid ?? null,
			owned: !0,
			startedAt: n(),
			readinessMs: null
		}), r.stdout && r.stdout.on("data", (e) => k(String(e), "stdout")), r.stderr && r.stderr.on("data", (e) => k(String(e), "stderr")), r.on("exit", (e, t) => {
			g === r && F(e, t);
		}), r.on("error", (e) => {
			let t = e instanceof Error ? e.message : String(e);
			k(`spawn error: ${t}`, "stderr"), g === r && (g = null, O({ pid: null }), I(`Could not start the backend process: ${t}`));
		}), p(`[lifecycle] spawned backend pid=${r.pid ?? "?"} entry=${e.entry}`), await B(r);
	}
	let z = 0;
	async function B(t) {
		let o = ++z, s = n(), c = !1, l = (t) => {
			c || o !== z || (c = !0, b !== null && (i(b), b = null), O(t), t.status === "failed" ? S === null && (S = a(() => {
				U();
			}, e.healthIntervalMs * 5)) : j());
		};
		for (b = r(() => {
			if (o !== z) return;
			let e = Math.round((n() - s) / 1e3);
			y = !0, P(), l({
				status: "failed",
				lastError: `Backend did not become healthy within ${e}s (readiness timeout).`
			});
		}, e.readyTimeoutMs); !c && !v;) {
			let r = await M();
			if (c || o !== z || g !== t) return;
			if (r.healthy) {
				l({
					status: "ready",
					lastHealthSuccessAt: n(),
					readinessMs: n() - s,
					lastError: null
				}), p(`[lifecycle] backend READY in ${n() - s}ms`);
				return;
			}
			if (O({ lastHealthFailureAt: n() }), await V(e.readinessPollMs), g !== t || o !== z) return;
		}
	}
	function V(e) {
		return new Promise((t) => {
			r(t, e);
		});
	}
	async function H() {
		if (v || _ || m.status === "failed") return;
		let t = await M();
		if (v) return;
		if (t.healthy) {
			w = 0, m.status === "ready" ? O({ lastHealthSuccessAt: n() }) : (O({
				status: "ready",
				lastHealthSuccessAt: n(),
				lastError: null,
				...m.startedAt ? {} : { startedAt: n() }
			}), p("[lifecycle] backend became READY (health recovered)"));
			return;
		}
		if (w += 1, O({ lastHealthFailureAt: n() }), e.mode === "EXTERNAL") {
			m.status === "ready" && O({ status: "reconnecting" }), w >= e.unhealthyTolerance && m.status !== "offline" && O({
				status: "offline",
				lastError: "Waiting for external backend — AgenticOS does not manage this backend process."
			});
			return;
		}
		if ((m.status === "ready" || m.status === "starting") && O({ status: "reconnecting" }), w < e.unhealthyTolerance) return;
		if (w = 0, g) {
			k("health check failed repeatedly while process alive — recycling backend process", "stderr"), y = !0, P(), O({
				status: "reconnecting",
				owned: !0,
				lastError: "Backend process alive but unhealthy — restarting it."
			}), L(200);
			return;
		}
		let r = t;
		if (r.reachable && !r.healthy) {
			I(`Port ${e.port} is occupied but the AgenticOS health check failed (${N(r)}). Another process is bound to the backend port.`);
			return;
		}
		O({
			owned: !1,
			restartCount: m.restartCount
		}), R();
	}
	async function U() {
		if (v || _ || m.status !== "failed") return;
		let e = await M();
		if (!v && e.healthy) {
			O({
				status: "ready",
				owned: !1,
				pid: null,
				lastHealthSuccessAt: n(),
				lastError: null,
				startedAt: n()
			}), p("[lifecycle] failed → adopted externally healthy backend (health recovered)"), A(), j();
			return;
		}
	}
	async function W() {
		O({
			mode: e.mode,
			status: "starting",
			lastError: null
		}), p(`[lifecycle] start (mode=${e.mode}, port=${e.port}, entry=${e.entry})`);
		let t = await M();
		if (t.healthy) {
			O({
				status: "ready",
				owned: !1,
				pid: null,
				lastHealthSuccessAt: n(),
				lastError: null,
				startedAt: n()
			}), p("[lifecycle] adopted existing healthy backend (no duplicate spawned)"), j();
			return;
		}
		if (t.reachable && !t.healthy) {
			I(`Port ${e.port} is occupied but the AgenticOS health check failed (${N(t)}). Another process is bound to the backend port — AgenticOS will not spawn a second backend.`);
			return;
		}
		if (e.mode === "EXTERNAL") {
			O({
				status: "offline",
				lastError: "Waiting for external backend — start the backend manually or use dev-clean.ps1."
			}), j();
			return;
		}
		await R();
	}
	async function G() {
		if (!v && (v = !0, A(), b !== null && (i(b), b = null), C !== null && (i(C), C = null), g)) {
			let e = g;
			if (g = null, p(`[lifecycle] shutting down owned backend pid=${e.pid ?? "?"}`), e.pid && process.platform === "win32") try {
				c("taskkill", [
					"/F",
					"/T",
					"/PID",
					String(e.pid)
				], {
					windowsHide: !0,
					stdio: "ignore"
				});
			} catch {}
			try {
				e.kill("SIGTERM");
			} catch {}
			await V(100);
			try {
				e.kill("SIGKILL");
			} catch {}
			O({
				pid: null,
				status: "offline",
				lastError: null
			});
		}
	}
	function K() {
		return e.mode === "EXTERNAL" ? {
			ok: !1,
			reason: "Backend mode is EXTERNAL — Electron does not own this backend process. Restart it where it is managed (e.g. your terminal or dev-clean.ps1)."
		} : g ? (E = !0, O({
			status: "reconnecting",
			lastError: null
		}), P(), { ok: !0 }) : m.status === "ready" ? {
			ok: !1,
			reason: "The running backend was adopted (started outside AgenticOS) — Electron does not own it and will not kill it. Use Retry if it becomes unhealthy."
		} : (T = [], E = !0, O({
			status: "reconnecting",
			lastError: null
		}), L(0), { ok: !0 });
	}
	function q() {
		return T = [], O({
			restartCount: 0,
			lastError: null
		}), w = 0, v ? {
			ok: !1,
			reason: "App is shutting down."
		} : m.status === "ready" ? {
			ok: !0,
			reason: "Backend already healthy."
		} : ((async () => {
			if (S !== null && (l(S), S = null), g) {
				E = !0, P();
				return;
			}
			O({ status: "starting" });
			let t = await M();
			if (t.healthy) {
				O({
					status: "ready",
					owned: !1,
					lastHealthSuccessAt: n(),
					lastError: null,
					startedAt: n()
				}), j();
				return;
			}
			if (t.reachable && !t.healthy) {
				I(`Port ${e.port} is occupied but the AgenticOS health check failed (${N(t)}).`);
				return;
			}
			if (e.mode === "EXTERNAL") {
				O({
					status: "offline",
					lastError: "Waiting for external backend."
				}), j();
				return;
			}
			await R();
		})(), { ok: !0 });
	}
	return {
		config: e,
		start: W,
		shutdown: G,
		getState: () => m,
		onStateChange: (e) => (h.add(e), () => {
			h.delete(e);
		}),
		restart: K,
		retry: q
	};
}
function m(e, t) {
	try {
		let t = o.join(e, "server", ".env"), n = s.readFileSync(t, "utf8").match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
		if (n) return parseInt(n[1], 10);
	} catch {}
	return t;
}
async function h(e, t) {
	try {
		let n = await fetch(e, { signal: AbortSignal.timeout(t) });
		return {
			reachable: !0,
			healthy: n.ok,
			httpStatus: n.status
		};
	} catch (e) {
		return {
			reachable: !1,
			healthy: !1,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
function g(e) {
	try {
		let e = c("node", ["--version"], {
			encoding: "utf8",
			timeout: 5e3,
			windowsHide: !0
		}).trim();
		if (/^v\d+\.\d+\.\d+$/.test(e)) return "node";
	} catch {}
	return e;
}
function _(e) {
	let t = g(e.nodeExec), n = t === e.nodeExec;
	return l(t, [e.entry], {
		cwd: e.cwd,
		env: n ? {
			...e.env,
			PORT: String(e.port),
			ELECTRON_RUN_AS_NODE: "1"
		} : {
			...e.env,
			PORT: String(e.port),
			ELECTRON_RUN_AS_NODE: void 0
		},
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		windowsHide: !0
	});
}
//#endregion
//#region electron/main.ts
t.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
var v = o.dirname(a(import.meta.url));
process.env.APP_ROOT = o.join(v, ".."), process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
var y = process.env.VITE_DEV_SERVER_URL, b = o.join(process.env.APP_ROOT, "dist-electron"), x = o.join(process.env.APP_ROOT, "dist"), S = process.env.AGENTICOS_ELECTRON_ROUTE || "#/mission-control", C = process.env.AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT;
function w() {
	let e = process.env.AGENTICOS_BACKEND_MODE;
	return e === "EXTERNAL" || e === "AUTO_MANAGED" ? e : process.env.AGENTICOS_EXTERNAL_SERVERS === "true" ? "EXTERNAL" : "AUTO_MANAGED";
}
var T = w();
function E() {
	for (let e of [process.stdout, process.stderr]) e && e.on("error", (e) => {
		if (!(e && (e.code === "EPIPE" || e.code === "ECONNRESET"))) try {
			console.error("[AgenticOS Electron] stdout/stderr stream error", e);
		} catch {}
	});
}
function D(e, t) {
	let n = t === void 0 ? e : `${e} ${JSON.stringify(t)}`;
	try {
		console.log(n);
	} catch {}
}
E(), C && (t.commandLine.appendSwitch("remote-debugging-port", C), D(`[AgenticOS Electron] Remote debugging port: ${C}`)), process.env.VITE_PUBLIC = y ? o.join(process.env.APP_ROOT, "public") : x;
var O = null, k = null, A = !1;
function j(e, t) {
	let n = t === void 0 ? e : `${e} ${JSON.stringify(t)}`;
	D(n);
	let r = process.env.AGENTICOS_ELECTRON_LOG || o.join(process.env.APP_ROOT || o.join(v, ".."), ".agentos", "logs", "electron-dev.log");
	if (r) try {
		s.mkdirSync(o.dirname(r), { recursive: !0 }), s.appendFileSync(r, `${(/* @__PURE__ */ new Date()).toISOString()} ${n}\n`, "utf8");
	} catch {}
}
function M() {
	let n = process.env.APP_ROOT, r = t.isPackaged ? process.resourcesPath : n, i = process.env.AGENTICOS_BACKEND_PORT ? parseInt(process.env.AGENTICOS_BACKEND_PORT, 10) : m(r, 4e3), a = t.getPath("userData"), s = t.isPackaged ? o.join(a, "data") : process.env.AGENTICOS_DATA_DIR || o.join(n, "server", "data"), c = o.join(s, "agentic-os.db"), l = t.isPackaged ? o.join(process.resourcesPath, "server", "data") : null, u = {
		...process.env,
		AGENTICOS_DATA_DIR: s,
		AGENT_TEAMS_DB_PATH: c,
		AGENTICOS_USER_DATA_DIR: a,
		...l ? { AGENTICOS_LEGACY_DATA_DIR: l } : {},
		AGENTICOS_IS_PACKAGED: t.isPackaged ? "true" : "false"
	}, d = p({
		mode: T,
		host: "127.0.0.1",
		port: i,
		entry: o.join(r, "server", "dist", "index.js"),
		cwd: o.join(r, "server"),
		nodeExec: process.execPath,
		env: u,
		healthPath: "/api/health",
		healthProbeTimeoutMs: 2500,
		readinessPollMs: 1e3,
		readyTimeoutMs: 6e4,
		healthIntervalMs: 5e3,
		maxRestarts: 3,
		backoffMs: [
			1e3,
			3e3,
			8e3
		],
		crashThreshold: 3,
		crashWindowMs: 6e4,
		unhealthyTolerance: 3,
		logFile: o.join(t.isPackaged ? a : n, ".agentos", "logs", "backend-managed.log")
	}, {
		probe: h,
		spawnBackend: _,
		log: (e) => j(e)
	});
	return d.onStateChange((t) => {
		for (let n of e.getAllWindows()) try {
			n.webContents.send("backend-lifecycle:state", t);
		} catch {}
	}), d;
}
function N() {
	j("Creating main window...");
	let t = 1240, n = 640, i, a;
	try {
		let { width: e, height: o, x: s, y: c } = r.getPrimaryDisplay().workArea;
		t = Math.min(1360, Math.max(960, e - 40)), n = Math.min(840, Math.max(580, o - 30)), i = s + Math.max(0, Math.floor((e - t) / 2)), a = c + Math.max(0, Math.floor((o - n) / 2)), j("Calculated window bounds for primary display:", {
			width: t,
			height: n,
			x: i,
			y: a,
			workWidth: e,
			workHeight: o
		});
	} catch (e) {
		j("Display bounds calculation error:", e?.message || String(e));
	}
	if (O = new e({
		width: t,
		height: n,
		...i !== void 0 && a !== void 0 ? {
			x: i,
			y: a
		} : {},
		minWidth: 800,
		minHeight: 500,
		title: "Agentic OS",
		icon: o.join(process.env.VITE_PUBLIC, "logo.jpg"),
		frame: !1,
		show: !0,
		backgroundColor: "#0a0a0d",
		webPreferences: {
			preload: o.join(v, "preload.cjs"),
			nodeIntegration: !1,
			contextIsolation: !0,
			backgroundThrottling: !1
		}
	}), O.setMenuBarVisibility(!1), O.webContents.setAudioMuted(!1), O.show(), O.focus(), j("[AgenticOS Electron] BrowserWindow count after create", { count: e.getAllWindows().length }), O.on("closed", () => {
		O = null;
	}), O.webContents.on("render-process-gone", (e, t) => {
		j("[AgenticOS Electron] render-process-gone", t), t.reason !== "clean-exit" && O && !O.isDestroyed() && (j("[AgenticOS Electron] Recovering crashed renderer..."), setTimeout(() => {
			O && !O.isDestroyed() && O.reload();
		}, 500));
	}), O.webContents.on("unresponsive", () => {
		j("[AgenticOS Electron] Window became unresponsive.");
	}), O.webContents.on("console-message", (e, t, n, r, i) => {
		j("[AgenticOS Renderer console]", {
			level: t,
			message: n,
			line: r,
			sourceId: i
		});
	}), O.webContents.on("did-finish-load", async () => {
		let t = O?.webContents.getURL() || "unknown", n = {};
		try {
			n = await O?.webContents.executeJavaScript("({\n        href: window.location.href,\n        buildId: window.__AGENTICOS_RENDERER_BUILD_ID || null,\n        buildTimestamp: window.__AGENTICOS_RENDERER_BUILD_TIMESTAMP || null,\n        voiceControllerInstanceId: document.querySelector('[data-testid=\"jarvis-voice-diagnostics\"]')?.textContent?.match(/voiceControllerInstanceId:\\s*([^\\n]+)/)?.[1]?.trim() || null\n      })");
		} catch (e) {
			n = { error: e?.message || String(e) };
		}
		j("[AgenticOS Electron] did-finish-load", {
			loadedUrl: t,
			rendererInfo: n,
			browserWindowCount: e.getAllWindows().length
		});
	}), O.webContents.on("did-navigate-in-page", (e, t) => {
		j("[AgenticOS Electron] did-navigate-in-page", { url: t });
	}), O.once("ready-to-show", () => {
		j("Window ready-to-show triggered."), O?.webContents.setAudioMuted(!1), O?.show(), O?.focus(), j("[AgenticOS Electron] Window visible state", {
			isVisible: O?.isVisible(),
			bounds: O?.getBounds()
		});
	}), y) {
		let e = `${y}${S}`;
		j("[AgenticOS Electron] Loading DEV server URL", { targetUrl: e }), j("[AgenticOS Electron] Vite URL", { viteUrl: y }), j("[AgenticOS Electron] Renderer route", { route: S }), j("[AgenticOS Electron] Renderer build env", {
			buildId: process.env.VITE_AGENTICOS_BUILD_ID || process.env.AGENTICOS_RENDERER_BUILD_ID || "unknown",
			buildTimestamp: process.env.VITE_AGENTICOS_BUILD_TIMESTAMP || process.env.AGENTICOS_RENDERER_BUILD_TIMESTAMP || "unknown"
		}), O.loadURL(e), O.webContents.openDevTools();
	} else O.loadFile(o.join(x, "index.html"), { hash: "/mission-control" });
}
n.on("window-minimize", () => O?.minimize()), n.on("window-maximize", () => {
	O?.isMaximized() ? O?.unmaximize() : O?.maximize();
}), n.on("window-close", () => {
	O && !O.isDestroyed() && (O.destroy(), O = null), t.quit();
}), n.on("agenticos:renderer-diagnostics", (t, n) => {
	j("[AgenticOS Electron] renderer-diagnostics", {
		payload: n,
		webContentsUrl: O?.webContents.getURL() || null,
		browserWindowCount: e.getAllWindows().length
	});
}), n.handle("backend-lifecycle:get-state", () => k?.getState() ?? null), n.handle("backend-lifecycle:restart", () => k?.restart() ?? {
	ok: !1,
	reason: "Lifecycle manager not initialized."
}), n.handle("backend-lifecycle:retry", () => k?.retry() ?? {
	ok: !1,
	reason: "Lifecycle manager not initialized."
}), n.handle("electron:get-identity", () => {
	let e = {
		buildId: null,
		gitSha: null,
		buildTimestamp: null
	};
	try {
		let n = [
			o.join(t.isPackaged ? process.resourcesPath : process.env.APP_ROOT, "server", "dist", "build-identity.json"),
			o.join(process.env.APP_ROOT, "server", "dist", "build-identity.json"),
			o.join(process.env.APP_ROOT, "server", "src", "build-identity.json")
		];
		for (let t of n) if (s.existsSync(t)) {
			e = JSON.parse(s.readFileSync(t, "utf8"));
			break;
		}
	} catch {}
	return {
		isPackaged: t.isPackaged,
		appVersion: t.getVersion(),
		appName: t.getName(),
		appPath: t.getAppPath(),
		userDataPath: t.getPath("userData"),
		exePath: process.execPath,
		resourcesPath: process.resourcesPath ?? null,
		platform: process.platform,
		arch: process.arch,
		electronVersion: process.versions.electron,
		chromeVersion: process.versions.chrome,
		nodeVersion: process.versions.node,
		buildId: e.buildId ?? null,
		gitSha: e.gitSha ?? null,
		buildTimestamp: e.buildTimestamp ?? null
	};
});
function P(n = O?.webContents) {
	let r = n ? e.fromWebContents(n) : O, i = n || r?.webContents || null;
	return {
		isOwnerWindowMuted: r?.webContents.isAudioMuted() ?? null,
		isWebContentsMuted: i?.isAudioMuted() ?? null,
		isAppSuspended: t.isSuspended?.() ?? null,
		browserWindowCount: e.getAllWindows().length
	};
}
n.handle("voice:get-audio-diagnostics", (e) => P(e.sender)), n.handle("voice:ensure-audio-unmuted", (t) => (t.sender.setAudioMuted(!1), (e.fromWebContents(t.sender) || O)?.webContents.setAudioMuted(!1), O?.webContents.setAudioMuted(!1), P(t.sender))), t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), O = null);
}), t.on("before-quit", (e) => {
	if (A || !k) return;
	A = !0, e.preventDefault(), j("Shutting down backend via lifecycle manager...");
	let n = setTimeout(() => {
		j("Backend shutdown timed out, forcing exit."), t.exit(0);
	}, 2500);
	k.shutdown().finally(() => {
		clearTimeout(n), j("Backend shutdown complete."), t.exit(0);
	});
}), t.requestSingleInstanceLock() ? (t.on("second-instance", () => {
	j("Second instance requested. Focusing or creating window."), O && !O.isDestroyed() ? (O.isMinimized() && O.restore(), O.show(), O.focus(), O.moveTop()) : N();
}), t.whenReady().then(() => {
	i.defaultSession.setPermissionRequestHandler((e, t, n) => {
		n(!0);
	}), i.defaultSession.setPermissionCheckHandler((e, t) => !0), k = M(), j(`Backend lifecycle mode: ${T}`, { port: k.getState().port }), N(), k.start(), t.on("activate", () => {
		e.getAllWindows().length === 0 && N();
	});
})) : (j("Another instance is already running. Quitting this instance immediately."), t.exit(0));
//#endregion
export { b as MAIN_DIST, x as RENDERER_DIST, y as VITE_DEV_SERVER_URL };
