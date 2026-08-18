//#endregion
//#region electron/preload.ts
var { ipcRenderer: e, contextBridge: t } = (/* @__PURE__ */ ((e) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(e, { get: (e, t) => (typeof require < "u" ? require : e)[t] }) : e)(function(e) {
	if (typeof require < "u") return require.apply(this, arguments);
	throw Error("Calling `require` for \"" + e + "\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.");
}))("electron");
t.exposeInMainWorld("ipcRenderer", {
	on(...t) {
		let [n, r] = t;
		return e.on(n, (e, ...t) => r(e, ...t));
	},
	off(...t) {
		let [n, ...r] = t;
		return e.off(n, ...r);
	},
	send(...t) {
		let [n, ...r] = t;
		return e.send(n, ...r);
	},
	invoke(...t) {
		let [n, ...r] = t;
		return e.invoke(n, ...r);
	}
}), t.exposeInMainWorld("backendLifecycle", {
	getState: () => e.invoke("backend-lifecycle:get-state"),
	restart: () => e.invoke("backend-lifecycle:restart"),
	retry: () => e.invoke("backend-lifecycle:retry"),
	onState: (t) => {
		let n = (e, n) => t(n);
		return e.on("backend-lifecycle:state", n), () => {
			e.removeListener("backend-lifecycle:state", n);
		};
	}
});
//#endregion
