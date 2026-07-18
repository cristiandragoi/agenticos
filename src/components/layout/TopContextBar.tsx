// @ts-nocheck
import { useData } from '../../store/dataStore';
import React from 'react';

import { useLocation } from 'react-router-dom';
import { Search, Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { useCommandPalette } from '../../store/appStore';
import MemorySyncWidget from '../ui/MemorySyncWidget';

const routeLabels: Record<string, string> = {
  '/': 'Mission Control',
  '/agents': 'Agents',
  '/runs': 'Runs',
  '/providers': 'Providers',
  '/memory': 'Memory',
  '/builds': 'Builds',
  '/control-room': 'Control Room',
  '/boards': 'Boards',
  '/research': 'Research',
  '/models': 'Models',
  '/settings': 'Settings',
};

const TopContextBar: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;

  const location = useLocation();
  const { toggle } = useCommandPalette();

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const currentLabel = routeLabels[location.pathname] || pathSegments[pathSegments.length - 1] || 'Home';
  const allHealthy = mockRuntimes.every(r => r.health.status === 'healthy');

  return (
    <div className="top-context-bar">
      {/* Breadcrumbs */}
      {location.pathname !== '/jarvis' ? (
        <div className="breadcrumbs">
          <span className="text-muted">Workspace</span>
          <span className="separator">/</span>
          <span className="current">{currentLabel}</span>
          {pathSegments.length > 1 && (
            <>
              <span className="separator">/</span>
              <span className="current text-muted">{pathSegments[pathSegments.length - 1]}</span>
            </>
          )}
        </div>
      ) : (
        <div className="breadcrumbs">
          <span className="current">Cockpit Online</span>
        </div>
      )}

      {/* Right section */}
      <div className="flex-row gap-3">
        <MemorySyncWidget />
        
        {/* Runtime health pills */}
        <div className="status-pill">
          {allHealthy ? (
            <CheckCircle2 size={12} color="var(--color-success)" />
          ) : (
            <AlertCircle size={12} color="var(--color-warning)" />
          )}
          <span className="text-xxs">{mockRuntimes.length} runtimes</span>
        </div>

        {/* Search / Command Palette trigger */}
        <div className="search-trigger" onClick={toggle}>
          <Search size={13} />
          <span>Search...</span>
          <span className="kbd">⌘K</span>
        </div>

        {/* Notifications */}
        <div style={{ position: 'relative', cursor: 'pointer' }}>
          <Bell size={17} color="var(--text-tertiary)" />
          <div style={{
            position: 'absolute', top: -1, right: -1,
            width: 7, height: 7,
            background: 'var(--color-error)',
            borderRadius: '50%',
            border: '1.5px solid var(--bg-base)',
          }} />
        </div>
      </div>
    </div>
  );
};

export default TopContextBar;


