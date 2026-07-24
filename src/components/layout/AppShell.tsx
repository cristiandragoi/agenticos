import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import LeftRail from './LeftRail';
import TopContextBar from './TopContextBar';
import UniversalChatDock from './UniversalChatDock';
import InspectorDrawer from './InspectorDrawer';
import CommandPalette from '../ui/CommandPalette';
import CustomTitlebar from './CustomTitlebar';
import { useCommandPalette, useDrawer } from '../../store/appStore';
import { useData } from '../../store/dataStore';

const AppShell: React.FC = () => {
  const { isOpen: commandPaletteOpen, toggle: toggleCommandPalette } = useCommandPalette();
  const location = useLocation();

  const { isLoading, error } = useData();

  const drawer = useDrawer();
  const hideGlobalChatDock =
    location.pathname === '/hermes-studio' ||
    location.pathname === '/jarvis' ||
    location.pathname === '/hermes' ||
    location.pathname === '/codex' ||
    location.pathname === '/mission-control';



  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        if (drawer.entityType === 'jarvis' && drawer.isOpen) {
          drawer.close();
        } else {
          drawer.open('jarvis', 'agent-jarvis');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCommandPalette, drawer]);

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>Agentic OS</div>
        <div className="text-muted">Connecting to backend...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>Backend unavailable</span>
        </div>
        <div className="text-muted">AgenticOS could not load live registry data.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
          <button className="btn">Open diagnostics</button>
        </div>
      </div>
    );
  }


  // ─── Normal shared shell for all other routes ───
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <CustomTitlebar />
      <div className="app-shell" style={{ flex: 1, height: 'calc(100vh - 32px)' }}>
        <LeftRail />

        <div className="main-column">
          <TopContextBar />

          <div
            className={`route-viewport${(location.pathname === '/hermes-studio' || location.pathname === '/jarvis' || location.pathname === '/codex') ? ' route-viewport--fullscreen' : ''}`}
            key={location.pathname}
          >
            <Outlet />
          </div>
        </div>

        {!hideGlobalChatDock && <UniversalChatDock />}
        {location.pathname !== '/jarvis' && <InspectorDrawer />}
        {commandPaletteOpen && <CommandPalette />}
      </div>
    </div>
  );
};

export default AppShell;
