import React, { useEffect, useLayoutEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import LeftRail from './LeftRail';
import TopContextBar from './TopContextBar';
import UniversalChatDock from './UniversalChatDock';
import InspectorDrawer from './InspectorDrawer';
import CommandPalette from '../ui/CommandPalette';
import CustomTitlebar from './CustomTitlebar';
import { useCommandPalette, useDrawer, useAppDispatch } from '../../store/appStore';
import { useData } from '../../store/dataStore';
import { useCodexStore } from '../../store/codexStore';
import { useBackendLifecycle } from '../../diagnostics/useBackendLifecycle';
import { backendLifecycleStore } from '../../diagnostics/backendLifecycleStore';

const AppShell: React.FC = () => {
  const { isOpen: commandPaletteOpen, toggle: toggleCommandPalette } = useCommandPalette();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const { isLoading, error, refresh } = useData();
  // ONE backend connection state (backend lifecycle milestone): the startup
  // and error screens render from the lifecycle manager, never from a guess.
  const lifecycle = useBackendLifecycle();

  const drawer = useDrawer();
  const hideGlobalChatDock =
    location.pathname === '/jarvis' ||
    location.pathname === '/codex' ||
    location.pathname === '/magnitude' ||
    location.pathname === '/mission-control';

  const { setActiveGoalId } = useCodexStore();

  useLayoutEffect(() => {
    let targetAgentId = 'agent-jarvis';
    if (location.pathname.startsWith('/hermes')) targetAgentId = 'agent-hermes';
    else if (location.pathname.startsWith('/codex')) targetAgentId = 'agent-codex';
    else if (location.pathname.startsWith('/magnitude')) targetAgentId = 'agent-magnitude';
    else if (location.pathname.startsWith('/jarvis')) targetAgentId = 'agent-jarvis';
    
    console.log('[ChatRoute]', { route: location.pathname, routeOwnedAgentId: targetAgentId, selectedAgentId: targetAgentId });
    dispatch({ type: 'SET_CHAT_TARGET', agentId: targetAgentId });

    if (targetAgentId !== 'agent-codex') {
      setActiveGoalId(null);
    }
  }, [location.pathname, dispatch, setActiveGoalId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        // M1 — one canonical Jarvis: Ctrl+J navigates to /jarvis instead of
        // opening a duplicate drawer voice controller.
        navigate('/jarvis');
      }
      // Agent quick-switch (navigation restoration alongside the rail)
      if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); navigate('/jarvis'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); navigate('/hermes-studio'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); navigate('/codex'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '4') { e.preventDefault(); navigate('/magnitude'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCommandPalette, navigate]);

  if (isLoading) {
    return (
      <div data-testid="app-startup-screen" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>Agentic OS</div>
        <div className="text-muted">
          {lifecycle.status === 'ready'
            ? 'Backend ready'
            : lifecycle.status === 'starting'
              ? 'Starting AgenticOS backend…'
              : lifecycle.status === 'reconnecting'
                ? `Reconnecting to backend${lifecycle.restartCount > 0 ? ` · attempt ${lifecycle.restartCount}/3` : ''}…`
                : 'Connecting to backend...'}
        </div>
      </div>
    );
  }

  // Backend still coming up (Electron is starting/restarting it): show the
  // truthful startup state instead of a hard error — Jarvis interaction is
  // enabled the moment the lifecycle reports ready.
  if (error && (lifecycle.status === 'starting' || lifecycle.status === 'reconnecting')) {
    return (
      <div data-testid="app-startup-screen" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>Agentic OS</div>
        <div className="text-muted">
          {lifecycle.status === 'starting'
            ? 'Starting AgenticOS backend…'
            : `Reconnecting to backend${lifecycle.restartCount > 0 ? ` · attempt ${lifecycle.restartCount}/3` : ''}…`}
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>Backend mode: {lifecycle.mode} · port {lifecycle.port}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="app-backend-error-screen" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>Backend unavailable</span>
        </div>
        <div className="text-muted">
          {lifecycle.status === 'failed'
            ? 'The backend could not be restored automatically.'
            : lifecycle.mode === 'EXTERNAL'
              ? 'Waiting for the external backend — AgenticOS does not manage this backend process.'
              : 'AgenticOS could not load live registry data.'}
        </div>
        <div className="text-muted" style={{ fontSize: 12, maxWidth: 520, textAlign: 'center' }}>
          Backend mode: {lifecycle.mode} · status: {lifecycle.status.toUpperCase()} · port {lifecycle.port}
          {lifecycle.restartCount > 0 ? ` · restart attempts ${lifecycle.restartCount}/3` : ''}
        </div>
        {lifecycle.lastError && (
          <div data-testid="app-backend-error-reason" className="text-muted" style={{ fontSize: 11, maxWidth: 560, textAlign: 'center', opacity: 0.85 }}>{lifecycle.lastError}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" data-testid="app-backend-retry" onClick={() => {
            // Re-probe the backend lifecycle AND re-run the registry data
            // load: the health probe alone does not clear the data error.
            void backendLifecycleStore.retry();
            void refresh();
          }}>Retry connection</button>
          <button className="btn" data-testid="app-backend-restart" onClick={() => { void backendLifecycleStore.restart(); }}>Restart backend</button>
        </div>
      </div>
    );
  }


  // ─── Normal shared shell for all other routes ───
  // Command-center exception: /jarvis keeps the navigation rail but drops
  // the top context bar, global chat dock and inspector drawer so the
  // command-center composition stays dominant (visual replacement cycle +
  // navigation restoration cycle).
  const jarvisFullscreen = location.pathname === '/jarvis';
  if (jarvisFullscreen) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <CustomTitlebar />
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <LeftRail />
          <div className="route-viewport route-viewport--fullscreen" style={{ flex: 1, minWidth: 0, height: '100%' }} key={location.pathname}>
            <Outlet />
          </div>
        </div>
        {commandPaletteOpen && <CommandPalette />}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <CustomTitlebar />
      <div className="app-shell" style={{ flex: 1, minHeight: 0, height: 'auto' }}>
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
