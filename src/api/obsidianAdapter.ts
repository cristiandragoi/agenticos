import type { ObsidianConfig } from '../types';

const BASE_URL = '/api';

class ObsidianMemoryAdapter {
  private config: ObsidianConfig = {
    vaultPath: '~/Documents/Obsidian Vault',
    folderMapping: {
      'agent': 'Agents',
      'workspace': 'Workspaces',
      'global': 'Global',
    },
    syncFrequency: 'manual',
    autoSummary: true,
    previewBeforeSync: false,
  };

  private pendingCount = 0;
  private failedCount = 0;
  private lastSyncedTime: string | null = null;
  private syncListeners: (() => void)[] = [];

  constructor() {
    this.connectStatusStream();
  }

  private connectStatusStream() {
    const sse = new EventSource(`${BASE_URL}/sync/status`);
    sse.onmessage = (e) => {
      try {
        const status = JSON.parse(e.data);
        this.pendingCount = status.pendingCount;
        this.failedCount = status.failedCount;
        this.lastSyncedTime = status.lastSyncedTime;
        this.notifyListeners();
      } catch (err) {}
    };
  }

  setConfig(newConfig: Partial<ObsidianConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.notifyListeners();
  }

  getConfig() {
    return this.config;
  }

  getPendingCount() {
    return this.pendingCount;
  }

  getFailedCount() {
    return this.failedCount;
  }

  getLastSyncedTime() {
    return this.lastSyncedTime;
  }

  subscribe(listener: () => void) {
    this.syncListeners.push(listener);
  }

  private notifyListeners() {
    this.syncListeners.forEach(l => l());
  }

  async syncNow() {
    await fetch(`${BASE_URL}/sync/now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config })
    });
  }

  async retryFailed() {
    await fetch(`${BASE_URL}/sync/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config })
    });
  }
}

export const obsidianAdapter = new ObsidianMemoryAdapter();

