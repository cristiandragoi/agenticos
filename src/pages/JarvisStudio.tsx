import React, { useState, useEffect } from 'react';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JarvisOrb } from '../components/ui/JarvisOrb';
import styles from './JarvisStudio.module.css';
import type { JarvisRuntimeStatus } from '../components/jarvis/JarvisChat';

export interface JarvisTelemetryEvent {
  id: string;
  timestamp: string;
  type: 'command' | 'route' | 'plan' | 'status' | 'error' | 'preview' | 'execution' | 'voice' | 'tool' | 'approval' | 'tts';
  message: string;
}

export default function JarvisStudio() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messagesForLog, setMessagesForLog] = useState<any[]>([]);
  const [composerText, setComposerText] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'transcribing' | 'speaking' | 'error'>('idle');

  const [runtimeStatus, setRuntimeStatus] = useState<JarvisRuntimeStatus>({
    state: 'idle',
    elapsedMs: 0,
    firstTokenMs: null,
    provider: null,
    model: null,
    error: null,
  });

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/jarvis/conversations');
      const data = await res.json();
      if (Array.isArray(data)) {
        setConversations(data);
        if (data.length > 0 && !activeConversationId) {
          // If the last conversation was CodeX-delegated, do not auto-select it to avoid stale CodeX UI state.
          // Since we don't have the messages here, we can just start fresh to be safe.
          // Or we can just start fresh every time the user navigates directly to /jarvis without an ID.
          // Wait, users probably want their last Jarvis conversation. 
          // We will just not auto-select to enforce a clean slate on navigation, preventing stale CodeX goals.
          setActiveConversationId(null);
        }
      } else {
        setConversations([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    const handleVoiceState = (e: CustomEvent<any>) => setVoiceState(e.detail);
    window.addEventListener('jarvis:voice-state' as any, handleVoiceState);
    return () => window.removeEventListener('jarvis:voice-state' as any, handleVoiceState);
  }, []);

  const handleCreateConversation = async () => {
    try {
      const res = await fetch('/api/jarvis/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      const data = await res.json();
      await fetchConversations();
      setActiveConversationId(data.id);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCommandSelect = (cmd: string) => {
    if (cmd === '/new') {
      handleCreateConversation();
    } else {
      setComposerText(prev => {
        const clean = prev.trim();
        if (clean.startsWith('/')) {
          const parts = clean.split(' ');
          parts[0] = cmd;
          const joined = parts.join(' ');
          return joined.endsWith(' ') ? joined : joined + ' ';
        }
        return cmd + ' ' + prev;
      });
    }
  };

  /** Map runtime + voice state → orb display state */
  const activeOrbState = (() => {
    if (voiceState === 'listening') return 'listening';
    if (voiceState === 'transcribing') return 'transcribing';
    if (voiceState === 'speaking') return 'speaking';
    if (runtimeStatus.state === 'error') return 'error';
    if (
      runtimeStatus.state === 'thinking' ||
      runtimeStatus.state === 'understanding' ||
      runtimeStatus.state === 'planning'
    )
      return 'thinking';
    if (runtimeStatus.state === 'streaming' || runtimeStatus.state === 'completed') return 'speaking';
    return 'idle';
  })() as 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

  const formatTime = (isoString?: string) => {
    try {
      const d = isoString ? new Date(isoString) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  };

  const matrixButtons = [
    { cmd: '/new', desc: 'FRESH THREAD' },
    { cmd: '/goal', desc: 'STANDING OBJECTIVE' },
    { cmd: '/profile', desc: 'PROFILE INFO' },
    { cmd: '/background', desc: 'ASYNC MISSION' },
    { cmd: '/personality', desc: 'SET PERSONA' },
    { cmd: '/kanban', desc: 'WORK QUEUE' },
  ];

  /** Derive Phase-1 telemetry strictly from existing message/runtime state */
  const telemetryEvents: JarvisTelemetryEvent[] = messagesForLog.map((msg, idx) => {
    const eventType = (() => {
      if (msg.role === 'user') return 'command';
      if (msg.messageType === 'routing_event') return 'route';
      if (msg.messageType === 'plan') return 'plan';
      if (msg.messageType === 'system_status') return 'status';
      if (msg.messageType === 'error') return 'error';
      if (msg.messageType === 'team_preview') return 'preview';
      if (msg.messageType === 'team_execution') return 'execution';
      return msg.role === 'assistant' ? 'tts' : 'status';
    })();

    return {
      id: msg.id || `event_${idx}_${msg.createdAt}`,
      timestamp: msg.createdAt || new Date().toISOString(),
      type: eventType as JarvisTelemetryEvent['type'],
      message: msg.content || '',
    };
  });

  return (
    <div className={styles.jarvisViewport} data-testid="jarvis-studio">
      {/* Single main column — no sidebar; sidebar removed to eliminate empty black column */}
      <div className={styles.mainColumn}>
        <JarvisWorkspaceBar />

        <div className={styles.jarvisActiveLayout} data-testid="jarvis-active-layout">
          {/* ── TOP ROW: 3-column cockpit dashboard ── */}
          <div className={styles.dashboardDashboard} data-testid="jarvis-dashboard">
            {/* LEFT: Command Matrix */}
            <div className={styles.commandMatrixPanel} data-testid="jarvis-command-matrix">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Command Matrix</span>
                <span className={styles.panelSubtitle}>Instruction Set</span>
              </div>
              <div className={styles.matrixGrid}>
                {matrixButtons.map(btn => (
                  <button
                    key={btn.cmd}
                    className={styles.matrixButton}
                    onClick={() => handleCommandSelect(btn.cmd)}
                  >
                    <span className={styles.matrixButtonCmd}>{btn.cmd}</span>
                    <span className={styles.matrixButtonDesc}>{btn.desc}</span>
                  </button>
                ))}
              </div>
              <div className={styles.pendingUplinkTitle}>Pending Uplink</div>
              <div className={styles.pendingUplinkArea} data-testid="pending-uplink">
                {composerText.trim() ? composerText : '(Awaiting command input...)'}
              </div>
            </div>

            {/* CENTRE: Reactor Orb — dominant visual element, no text inside core */}
            <div className={styles.reactorOrbPanel} data-testid="jarvis-reactor-orb">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Reactor Status</span>
                <span className={styles.panelSubtitle}>Core Telemetry</span>
              </div>
              {/* orbWrapper gives JarvisOrb a definite height (flex: 1) so height:100% resolves */}
              <div className={styles.orbWrapper} data-testid="jarvis-orb-wrapper">
                <JarvisOrb
                  state={activeOrbState}
                  errorMessage={runtimeStatus.error || undefined}
                />
              </div>
              {/* Status label lives OUTSIDE the orb core */}
              <div
                className={styles.orbExternalStatus}
                data-testid="jarvis-orb-status-label"
              >
                {activeOrbState}
              </div>
            </div>

            {/* RIGHT: Action Log */}
            <div className={styles.actionLogPanel} data-testid="jarvis-inspector">
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Action Log</span>
                <span className={styles.panelSubtitle}>Live Telemetry</span>
              </div>
              {telemetryEvents.length > 0 ? (
                <div className={styles.actionLogList}>
                  {telemetryEvents.map((evt, i) => (
                    <div key={evt.id || i} className={styles.actionLogItem}>
                      <span className={styles.actionLogTime}>{formatTime(evt.timestamp)}</span>
                      <span className={styles.actionLogMsg}>
                        <strong style={{ color: 'var(--color-jarvis)' }}>
                          {evt.type.toUpperCase()}
                        </strong>{' '}
                        {evt.message}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.actionLogEmpty} data-testid="action-log-empty">
                  <span>No telemetry data available.</span>
                </div>
              )}
            </div>
          </div>

          {/* ── BOTTOM ROW: Chat timeline + composer ── */}
          <div className={styles.bottomTimelineArea} data-testid="jarvis-chat-workspace">
            <JarvisChat
              conversationId={activeConversationId}
              onConversationCreated={(id) => setActiveConversationId(id)}
              onStatusChange={setRuntimeStatus}
              onMessagesChange={setMessagesForLog}
              composerText={composerText}
              onComposerTextChange={setComposerText}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
