// @ts-nocheck
import { useData } from '../store/dataStore';
import React from 'react';
import { mockRuntimes } from '../mocks/data';

const SettingsPage: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;

  return (
    <div className="flex-col h-full" style={{ maxWidth: 800 }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Settings</h1>
          <p>System configuration and defaults.</p>
        </div>
      </div>

      <div className="flex-col gap-6">
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Workspace Configuration</span>
          </div>
          <div className="flex-col gap-4 text-sm">
            <div>
              <div className="text-secondary mb-1">Workspace ID</div>
              <input type="text" value="ws-1" readOnly className="chat-dock__input" style={{ width: '100%' }} />
            </div>
            <div>
              <div className="text-secondary mb-1">Environment</div>
              <input type="text" value="development" readOnly className="chat-dock__input" style={{ width: '100%' }} />
            </div>
          </div>
        </div>

        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Registered Runtimes</span>
          </div>
          <div className="flex-col gap-2 text-sm">
            {mockRuntimes.map(rt => (
              <div key={rt.id} className="flex-row justify-between p-2" style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)' }}>
                <span>{rt.label} <span className="text-muted">({rt.adapterType})</span></span>
                <span className="text-secondary">{rt.eventProtocol}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Memory Sync Settings */}
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="font-semibold text-primary">Memory Sync & External Vaults</span>
          </div>
          <div className="flex-col gap-4 text-sm">
            <div>
              <div className="text-secondary mb-1">Obsidian Vault Path</div>
              <input type="text" defaultValue="~/Documents/ObsidianVault" className="chat-dock__input" style={{ width: '100%' }} />
              <div className="text-dim text-xxs mt-1">Absolute path to your local Obsidian vault.</div>
            </div>
            <div>
              <div className="text-secondary mb-1">Global Sync Policy</div>
              <select className="chat-dock__input" style={{ width: '100%', background: 'var(--bg-base)' }} defaultValue="batched">
                <option value="immediate">Immediate</option>
                <option value="batched">Batched (every 5 events)</option>
                <option value="once-daily">Once Daily</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>
            <div className="flex-row align-center gap-2">
              <input type="checkbox" id="auto-summary" defaultChecked />
              <label htmlFor="auto-summary" className="text-secondary cursor-pointer">Auto-summarize conversation runs before syncing</label>
            </div>
            <div className="flex-row align-center gap-2">
              <input type="checkbox" id="preview-before-sync" />
              <label htmlFor="preview-before-sync" className="text-secondary cursor-pointer">Preview before sync</label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
