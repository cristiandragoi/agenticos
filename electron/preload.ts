const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Backend lifecycle bridge — the renderer's single source of truth for
// backend connectivity (AUTO_MANAGED / EXTERNAL). See
// src/diagnostics/backendLifecycleStore.ts.
contextBridge.exposeInMainWorld('backendLifecycle', {
  getState: () => ipcRenderer.invoke('backend-lifecycle:get-state'),
  restart: () => ipcRenderer.invoke('backend-lifecycle:restart'),
  retry: () => ipcRenderer.invoke('backend-lifecycle:retry'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('backend-lifecycle:state', listener);
    return () => {
      ipcRenderer.removeListener('backend-lifecycle:state', listener);
    };
  },
})
