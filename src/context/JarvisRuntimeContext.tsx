import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoiceIO } from '../hooks/useVoiceIO';
import type { JarvisChatHandle, JarvisRuntimeStatus, JarvisRuntimeState } from '../components/jarvis/JarvisChat';
import type { MicState } from '../components/jarvis/JarvisComposer';
import { voiceTracePush } from '../diagnostics/voiceTrace';
import { getActiveJarvisEngine, setActiveJarvisEngine, stopAllJarvisAudio } from '../lib/jarvisEngineAuthority';
import { apiUrl } from '../api/client';
import { jarvisLiveKitSession } from '../lib/jarvisLiveKitSession';
import { JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import { JARVIS_BUILD_ID } from '../buildInfo';

export interface WorkspaceContextData {
  activeModule?: string;
  activeRoute?: string;
  selectedProject?: string;
  selectedMission?: string;
  selectedArtifact?: string;
  moduleStateSummary?: string;
}

export interface JarvisRuntimeContextValue {
  // Engine authority
  activeEngine: 'v1' | 'v2';
  setActiveEngine: (engine: 'v1' | 'v2') => void;

  // Voice engine & state
  voice: ReturnType<typeof useVoiceIO>;
  voiceRef: React.MutableRefObject<ReturnType<typeof useVoiceIO>>;
  micState: MicState;
  setMicState: React.Dispatch<React.SetStateAction<MicState>>;
  runtimeStatus: JarvisRuntimeStatus;
  setRuntimeStatus: React.Dispatch<React.SetStateAction<JarvisRuntimeStatus>>;
  orbRuntimeState: JarvisRuntimeState;
  
  // Conversation
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  conversationLanguage: string;
  setConversationLanguage: (lang: string) => void;
  selectedVoice: string;
  setSelectedVoice: (v: string) => void;
  handleLanguageChange: (newLang: string) => void;
  
  // Transcripts & buffering
  voiceInterimTranscript: string;
  setVoiceInterimTranscript: React.Dispatch<React.SetStateAction<string>>;
  composerText: string;
  setComposerText: React.Dispatch<React.SetStateAction<string>>;
  handleComposerTextChange: (text: string) => void;
  handleVoiceTranscript: (text: string) => void;
  
  // Progressive speech handlers
  handleStreamDelta: (delta: string, channel: 'typed' | 'voice', turnId?: number) => void;
  handleAssistantDone: (text: string, channel: 'typed' | 'voice', turnId?: number) => void;
  flushSpeechBuffer: (forceAll?: boolean, turnId?: number) => void;
  
  stopOutput: () => void;
  stopSpeaking: () => void;
  cancelRequest: () => void;
  endConversation: () => void;
  lastVoiceRejection: { text: string; reason: string; category: string } | null;
  clearVoiceRejection: () => void;
  beginOutput: () => number;
  // Execution & navigation
  workspaceContext: WorkspaceContextData;
  setWorkspaceContext: React.Dispatch<React.SetStateAction<WorkspaceContextData>>;
  latestActionRecord: any | null;
  setLatestActionRecord: (record: any | null) => void;
  actionHistory: any[];
  activeChatRef: React.MutableRefObject<JarvisChatHandle | null>;
  turnSeqRef: React.MutableRefObject<number>;
  
  // Dock visibility state
  isDockCollapsed: boolean;
  setIsDockCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  toggleDock: () => void;
}

const JarvisRuntimeContext = createContext<JarvisRuntimeContextValue | null>(null);

const VOICE_KEY = 'jarvis-canonical-voice';
const ACTIVE_CONV_KEY = 'jarvis-active-conversation';

function readPersistedVoice(): string {
  try {
    const lv = localStorage.getItem(VOICE_KEY);
    if (lv) return lv;
    const sv = sessionStorage.getItem(VOICE_KEY);
    if (sv) return sv;
  } catch { /* storage unavailable */ }
  return 'en-GB-RyanNeural';
}

function readPersistedConv(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_CONV_KEY) || localStorage.getItem(ACTIVE_CONV_KEY) || null;
  } catch { return null; }
}

export const JarvisRuntimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(readPersistedConv);
  const setActiveConversationId = useCallback((id: string | null) => {
    setActiveConversationIdState(id);
    try {
      if (id) {
        sessionStorage.setItem(ACTIVE_CONV_KEY, id);
        localStorage.setItem(ACTIVE_CONV_KEY, id);
      } else {
        sessionStorage.removeItem(ACTIVE_CONV_KEY);
        localStorage.removeItem(ACTIVE_CONV_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const [conversationLanguage, setConversationLanguage] = useState<string>('en');
  const [selectedVoice, setSelectedVoiceState] = useState<string>(readPersistedVoice);
  const setSelectedVoice = useCallback((v: string) => {
    setSelectedVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
      sessionStorage.setItem(VOICE_KEY, v);
      fetch('/api/jarvis-next/agent/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: v }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (selectedVoice) {
      fetch('/api/jarvis-next/agent/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: selectedVoice }),
      }).catch(() => {});
    }
  }, []);

  const handleLanguageChange = useCallback((newLang: string) => {
    const raw = (newLang || 'en').toLowerCase().trim();
    const code = raw === 'auto' ? 'en' : raw.slice(0, 2);
    setConversationLanguage(code);
    const targetVoice =
      code === 'de' ? 'de_DE-thorsten-high' :
      code === 'ro' ? 'ro_RO-mihai-medium' :
      'en-GB-RyanNeural';
    setSelectedVoice(targetVoice);
    voiceRef.current?.setLanguage?.(code);
    voiceRef.current?.setVoiceOverride?.(targetVoice);
  }, [setSelectedVoice]);

  const [composerText, setComposerText] = useState('');
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const toggleDock = useCallback(() => setIsDockCollapsed((c) => !c), []);

  const [activeEngine, setActiveEngineState] = useState<'v1' | 'v2'>(getActiveJarvisEngine);
  const setActiveEngine = useCallback((engine: 'v1' | 'v2') => {
    setActiveJarvisEngine(engine);
    setActiveEngineState(engine);
  }, []);

  useEffect(() => {
    console.log('[JARVIS_FRONTEND_INIT]', {
      FRONTEND_BUILD_ID: JARVIS_BUILD_ID,
      FRONTEND_SOURCE_PATH: 'src/context/JarvisRuntimeContext.tsx',
      WINDOW_LOCATION: typeof window !== 'undefined' ? window.location.href : 'unknown',
      CURRENT_ROUTE: location.pathname + (location.search || ''),
    });
  }, []);

  useEffect(() => {
    const onEngineChange = (e: any) => {
      const eng = e.detail?.engine;
      if (eng) {
        setActiveEngineState(eng);
        outputStoppedRef.current = true;
        speechBufferRef.current = '';
        activeChatRef.current?.cancelResponse?.();
        voiceRef.current?.stopSpeaking?.();
        voiceRef.current?.resetTurnLatch?.('engine_switch');
      }
    };
    window.addEventListener('jarvis:engine-changed', onEngineChange);
    return () => window.removeEventListener('jarvis:engine-changed', onEngineChange);
  }, []);

  const [runtimeStatus, setRuntimeStatus] = useState<JarvisRuntimeStatus>({
    state: 'idle',
    elapsedMs: 0,
    firstTokenMs: null,
    provider: null,
    model: null,
    error: null,
  });

  const activeChatRef = useRef<JarvisChatHandle | null>(null);
  const turnSeqRef = useRef<number>(0);
  const manualEditSinceVoiceRef = useRef(false);
  const speechBufferRef = useRef<string>('');
  const receivedDeltaRef = useRef(false);
  const outputStoppedRef = useRef(false);

  // Action record & execution evidence store
  const [latestActionRecord, setLatestActionRecordState] = useState<any | null>(null);
  const [actionHistory, setActionHistory] = useState<any[]>([]);
  const setLatestActionRecord = useCallback((rec: any | null) => {
    setLatestActionRecordState(rec);
    if (rec) {
      setActionHistory((prev) => [rec, ...prev.slice(0, 49)]);
    }
  }, []);

  // Structured workspace context derived from active route
  const [customWorkspaceContext, setWorkspaceContext] = useState<WorkspaceContextData>({});
  const workspaceContext = useMemo<WorkspaceContextData>(() => {
    const route = location.pathname;
    let activeModule = 'general';
    if (route.startsWith('/revenue')) activeModule = 'revenue-operator';
    else if (route.startsWith('/hermes')) activeModule = 'hermes-studio';
    else if (route.startsWith('/codex')) activeModule = 'codex';
    else if (route.startsWith('/magnitude')) activeModule = 'magnitude';
    else if (route.startsWith('/boards')) activeModule = 'boards';
    else if (route.startsWith('/memory')) activeModule = 'memory';
    else if (route.startsWith('/jarvis')) activeModule = 'jarvis-command-center';

    return {
      activeModule,
      activeRoute: route,
      ...customWorkspaceContext,
    };
  }, [location.pathname, customWorkspaceContext]);

  // Input ownership
  const handleComposerTextChange = useCallback((text: string) => {
    setComposerText(text);
    if (text.trim().length > 0) {
      manualEditSinceVoiceRef.current = true;
      voiceRef.current?.notifyManualEdit?.();
    } else {
      manualEditSinceVoiceRef.current = false;
    }
  }, []);

  const handleVoiceTranscript = useCallback((text: string) => {
    if (manualEditSinceVoiceRef.current) {
      setVoiceInterimTranscript(text);
      return;
    }
    setComposerText(text);
    setVoiceInterimTranscript('');
  }, []);

  // Progressive sentence flusher
  const flushSpeechBuffer = useCallback((forceAll = false, turnId?: number) => {
    if (outputStoppedRef.current) return;
    const text = speechBufferRef.current;
    if (!text) return;
    const effectiveTurnId = typeof turnId === 'number' ? turnId : turnSeqRef.current;

    if (forceAll) {
      const remaining = text.trim();
      speechBufferRef.current = '';
      if (remaining && getActiveJarvisEngine() === 'v1') {
        voiceRef.current?.speakProgressive?.(remaining, 'CONVERSATION', effectiveTurnId);
      }
      return;
    }

    const match = text.match(/^(.*?[.!?\n]+(?:\s+|$))(.*)$/s);
    if (match) {
      const sentence = match[1].trim();
      speechBufferRef.current = match[2];
      if (sentence && getActiveJarvisEngine() === 'v1') {
        voiceRef.current?.speakProgressive?.(sentence, 'CONVERSATION', effectiveTurnId);
      }
    }
  }, []);

  const handleStreamDelta = useCallback((delta: string, channel: 'typed' | 'voice', turnId?: number) => {
    void channel;
    if (typeof turnId === 'number' && turnId !== turnSeqRef.current) {
      return;
    }
    if (!receivedDeltaRef.current) {
      outputStoppedRef.current = false;
      receivedDeltaRef.current = true;
      const effectiveTurnId = typeof turnId === 'number' ? turnId : turnSeqRef.current;
      voiceRef.current?.armSpeech?.(effectiveTurnId);
    }
    if (outputStoppedRef.current) return;
    speechBufferRef.current += delta;
    flushSpeechBuffer(false, turnId);
  }, [flushSpeechBuffer]);

  const handleAssistantDone = useCallback((text: string, channel: 'typed' | 'voice', turnId?: number) => {
    void channel;
    if (typeof turnId === 'number' && turnId !== turnSeqRef.current) {
      return;
    }
    const effectiveTurnId = typeof turnId === 'number' ? turnId : turnSeqRef.current;
    if (!receivedDeltaRef.current) {
      outputStoppedRef.current = false;
      voiceRef.current?.armSpeech?.(effectiveTurnId);
    }
    if (outputStoppedRef.current) return;
    const buffered = speechBufferRef.current;
    flushSpeechBuffer(true, turnId);
    const after = speechBufferRef.current;
    if (!receivedDeltaRef.current && !buffered && !after && text && text.trim().length > 0 && getActiveJarvisEngine() === 'v1') {
      voiceRef.current?.speakProgressive?.(text, 'CONVERSATION', effectiveTurnId);
    }
  }, [flushSpeechBuffer]);

  const stopSpeaking = useCallback(() => {
    outputStoppedRef.current = true;
    speechBufferRef.current = '';
    voiceRef.current?.stopSpeaking?.();
    void jarvisLiveKitSession.stopSpeaking();
    voiceTracePush('stop_speaking', 'ok', 'Playback halted, mic listening preserved');
  }, []);

  const cancelRequest = useCallback(() => {
    outputStoppedRef.current = true;
    ++turnSeqRef.current;
    speechBufferRef.current = '';
    voiceRef.current?.stopSpeaking?.();
    void jarvisLiveKitSession.stopSpeaking();
    activeChatRef.current?.cancelResponse();
    voiceRef.current?.resetTurnLatch?.('cancelRequest');
    voiceTracePush('cancel_request', 'ok', 'Model request cancelled, latch reset, mic listening preserved');
  }, []);

  const endConversation = useCallback(async () => {
    outputStoppedRef.current = true;
    ++turnSeqRef.current;
    speechBufferRef.current = '';
    voiceRef.current?.stopSpeaking?.();
    activeChatRef.current?.cancelResponse?.();
    voiceRef.current?.resetTurnLatch?.('endConversation');
    await jarvisLiveKitSession.stopSession();
    setMicState('idle');
    voiceTracePush('end_conversation', 'ok', 'Conversation ended and mic closed');
  }, []);

  const stopOutput = useCallback(() => {
    cancelRequest();
  }, [cancelRequest]);

  const beginOutput = useCallback(() => {
    voiceRef.current?.stopSpeaking();
    outputStoppedRef.current = false;
    receivedDeltaRef.current = false;
    speechBufferRef.current = '';
    const id = ++turnSeqRef.current;
    voiceRef.current?.armSpeech(id);
    return id;
  }, []);

  // SINGLE AUTHORITATIVE useVoiceIO INSTANCE
  const legacyVoice = useVoiceIO({
    agentId: 'agent-jarvis',
    conversationId: activeConversationId,
    language: conversationLanguage,
    voiceOverride: selectedVoice,
    endSpeechSilenceMs: 750,

    // Phase 1: renderer-side voice submission is disabled. Every spoken utterance is
    // captured by the LiveKit session and submitted by the server agent to the single
    // TurnLifecycleController. The previous V1 (/message/stream) and V2
    // (/api/jarvis-v2/.../voice/turn, now 410 Gone) submission branches were removed so a
    // renderer transcript can never become a second execution of the same utterance.
    onAutoSubmit: async (text) => {
      console.warn('[JarvisRuntime] renderer auto-submit ignored (LiveKit owns voice turns):', text);
    },
    onBargeIn: () => {
      speechBufferRef.current = '';
      activeChatRef.current?.cancelResponse();
      voiceRef.current?.resetTurnLatch?.('onBargeIn');
    },
    onControlCommand: (cmd) => {
      speechBufferRef.current = '';
      if (cmd.action === 'end_conversation') {
        endConversation();
      } else if (cmd.action === 'stop_speech') {
        stopSpeaking();
      } else {
        cancelRequest();
      }
    },
    onTranscript: handleVoiceTranscript,
    onStateChange: () => {},
  });

  // Subscribe to canonical LiveKit session state
  const [liveKitState, setLiveKitState] = useState(() => jarvisLiveKitSession.getState());

  useEffect(() => {
    return jarvisLiveKitSession.subscribe(() => {
      const s = jarvisLiveKitSession.getState();
      setLiveKitState(s);
      if (s.isConnected) {
        setMicState('listening');
      } else if (s.sessionState === 'disconnected') {
        setMicState('idle');
      }
    });
  }, []);

  // Listen for real-time LiveKit server transcripts and state changes
  const [liveKitTranscript, setLiveKitTranscript] = useState('');
  const [liveKitResponse, setLiveKitResponse] = useState('');

  // The app router's location is the truthful route source (not window.location,
  // which jsdom cannot navigate and which is not what the view mounted from).
  const routerLocationRef = useRef(location);
  useEffect(() => { routerLocationRef.current = location; }, [location]);

  useEffect(() => {
    /** Canonical packet shape shared by the LiveKit and SSE transports (D14). */
    type NavPacketLike = {
      navId?: string; navigationId?: string; targetRoute?: string; route?: string;
      entityId?: string; entityType?: string;
    };
    /**
     * D14 §4 — ONE navigation receiver for BOTH transports (the LiveKit data
     * channel and the typed chat's SSE stream). The ACK is sent only after the
     * router AND the mounted project are confirmed by actual state — never
     * merely because navigate() was called.
     */
    const handleNavigationRequest = (data: NavPacketLike, transport: 'livekit' | 'sse') => {
      const navId = data?.navId || data?.navigationId;
      const route = data?.targetRoute || data?.route;
      const entityId = data?.entityId;
      const entityType = data?.entityType;
      if (!navId || !route) {
        console.warn('[JFE-NAV] navigation request missing navId/targetRoute', data);
        return;
      }
      void (async () => {
        const routeBefore = location.pathname + (location.search || '');
        console.log(`[JFE-NAV] NAV_RECEIVE transport=${transport} room=${jarvisLiveKitSession.getState().roomName || ''} navId=${navId}`);
        console.log(`[JFE-NAV] FRONTEND_PACKET_RECEIVED=true FRONTEND_BUILD_ID=${JARVIS_BUILD_ID} FRONTEND_ROUTE_BEFORE=${routeBefore}`);

        try {
          navigate(route);
          console.log('[JFE-NAV] REACT_NAVIGATE_CALLED=true');
        } catch (navErr: any) {
          console.error('[JFE-NAV] navigate error:', navErr);
        }

        // Wait for router + view to settle, then inspect ACTUAL state.
        const wantProject = String(entityType || '').toLowerCase() === 'project';
        const normalise = (u: string) => (u || '').replace(/\/+$/, '').toLowerCase();
        let actualRoute = routeBefore;
        let activeProjectId = '';
        let routeOk = false;
        let projectOk = !wantProject;
        let success = false;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 80));
          const loc = routerLocationRef.current;
          actualRoute = `${loc.pathname}${loc.search || ''}`;
          const params = new URLSearchParams(loc.search || '');
          activeProjectId = params.get('project') || params.get('projectId') || '';
          routeOk = normalise(actualRoute) === normalise(route);
          projectOk = !wantProject || !entityId || activeProjectId === entityId;
          if (routeOk && projectOk) { success = true; break; }
        }
        console.log(`[JFE-NAV] FRONTEND_ROUTE_AFTER=${actualRoute} ACTIVE_PROJECT=${activeProjectId || 'none'} routeOk=${routeOk} projectOk=${projectOk}`);

        if (success && entityId) {
          setWorkspaceContext((prev) => ({
            ...prev,
            activeRoute: actualRoute,
            selectedProject: wantProject ? entityId : prev.selectedProject,
          }));
        }

        const error = success
          ? undefined
          : (!routeOk ? `route_mismatch:${actualRoute}` : `project_mismatch:${activeProjectId || 'none'}`);
        const ack = { navId, success, actualRoute, activeProjectId, visibleEntityId: activeProjectId || entityId, error };
        console.log(`[JFE-NAV] NAV_ACK_SEND transport=${transport} navId=${navId} success=${success}`, ack);

        // HTTP ACK always (typed turns have no LiveKit room) …
        try {
          await fetch(apiUrl('/api/jarvis/navigation/ack'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ack),
          });
        } catch (ackErr) {
          console.warn('[JFE-NAV] HTTP ACK failed', ackErr);
        }
        // … plus the LiveKit ACK (legacy-exact shape: the voice verifier and the
        // existing navigation tests consume exactly these keys).
        void jarvisLiveKitSession.sendData({
          type: 'NAVIGATE_ACK',
          navigationId: navId,
          success,
          actualRoute,
          visibleEntityId: ack.visibleEntityId,
          error,
        });

        if (typeof window !== 'undefined') {
          (window as any).__LAST_JARVIS_NAVIGATION__ = {
            ...ack, navId, navigationId: navId, route, entityId, entityType, transport, timestamp: Date.now(),
          };
          window.dispatchEvent(new CustomEvent('jarvis:navigation', { detail: { ...ack, route, entityId, entityType } }));
        }
      })();
    };

    const offData = jarvisLiveKitSession.onData((data: any) => {
      if (!data) return;
      if (data.type === 'transcript' && typeof data.text === 'string') {
        setLiveKitTranscript(data.text);
        handleVoiceTranscript(data.text);
        voiceTracePush('transcript', 'ok', data.text);
      } else if (data.type === 'assistant_text' && typeof data.text === 'string') {
        setLiveKitResponse(data.text);
        voiceTracePush('assistant_reply', 'ok', data.text);
      } else if (data.type === 'status') {
        if (data.state === 'thinking') {
          setRuntimeStatus((prev) => ({ ...prev, state: 'thinking' }));
        } else if (data.state === 'speaking') {
          setRuntimeStatus((prev) => ({ ...prev, state: 'streaming' }));
          window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackStarted));
        } else if (data.state === 'listening') {
          setRuntimeStatus((prev) => ({ ...prev, state: 'idle' }));
          window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded));
        }
      } else if (data.type === 'NAVIGATE_REQUEST' || data.type === 'navigation' || data.type === 'navigation_request') {
        handleNavigationRequest(data, 'livekit');
      }
    });

    const onWindowNavRequest = (ev: Event) => handleNavigationRequest((ev as CustomEvent).detail, 'sse');
    window.addEventListener('jarvis:navigation-request', onWindowNavRequest);
    return () => {
      offData?.();
      window.removeEventListener('jarvis:navigation-request', onWindowNavRequest);
    };
  }, [handleVoiceTranscript, navigate, location]);

  const canonicalVoice = useMemo(() => {
    return {
      ...legacyVoice,
      startConversation: async (): Promise<boolean> => {
        console.log('[JFE] VOICE_REF_START');
        return await legacyVoice.startConversation();
      },
      endConversation: async (): Promise<void> => {
        await legacyVoice.endConversation();
      },
      stopSpeaking: async (): Promise<void> => {
        await jarvisLiveKitSession.stopSpeaking();
        legacyVoice.stopSpeaking?.();
      },
      killSpeechNow: async (): Promise<void> => {
        await jarvisLiveKitSession.stopSpeaking();
        legacyVoice.killSpeechNow?.();
      },
      get lastTranscript() { return liveKitTranscript || legacyVoice.lastTranscript; },
      get lastResponse() { return liveKitResponse || legacyVoice.lastResponse; },
      get isConnected() { return jarvisLiveKitSession.isConnected; },
      get conversationActive() { return jarvisLiveKitSession.isConnected; },
      get isListening() { return jarvisLiveKitSession.getState().isListening; },
      get isSpeaking() { return jarvisLiveKitSession.getState().isSpeaking; },
      get voiceState() {
        const s = jarvisLiveKitSession.getState();
        if (s.isSpeaking) return 'speaking' as const;
        if (s.isConnected) return 'listening' as const;
        if (s.isConnecting) return 'thinking' as const;
        if (s.sessionState === 'error') return 'error' as const;
        return 'idle' as const;
      },
    };
  }, [legacyVoice, liveKitState, liveKitTranscript, liveKitResponse]);

  const voiceRef = useRef<any>(canonicalVoice);
  voiceRef.current = canonicalVoice;

  useEffect(() => {
    if (micState !== 'listening') {
      voiceRef.current?.notifyMicOff?.();
    }
  }, [micState]);

  useEffect(() => {
    voiceRef.current?.setVoiceOverride?.(selectedVoice);
  }, [selectedVoice]);

  const orbRuntimeState: JarvisRuntimeState = runtimeStatus.state;

  const value = useMemo<JarvisRuntimeContextValue>(() => ({
    activeEngine,
    setActiveEngine,
    voice: canonicalVoice as any,
    voiceRef,
    stopOutput,
    stopSpeaking,
    cancelRequest,
    endConversation,
    lastVoiceRejection: legacyVoice.lastVoiceRejection,
    clearVoiceRejection: legacyVoice.clearVoiceRejection,
    beginOutput,
    micState,
    setMicState,
    runtimeStatus,
    setRuntimeStatus,
    orbRuntimeState,
    activeConversationId,
    setActiveConversationId,
    conversationLanguage,
    setConversationLanguage,
    selectedVoice,
    setSelectedVoice,
    handleLanguageChange,
    voiceInterimTranscript,
    setVoiceInterimTranscript,
    composerText,
    setComposerText,
    handleComposerTextChange,
    handleVoiceTranscript,
    handleStreamDelta,
    handleAssistantDone,
    flushSpeechBuffer,
    workspaceContext,
    setWorkspaceContext,
    latestActionRecord,
    setLatestActionRecord,
    actionHistory,
    activeChatRef,
    turnSeqRef,
    isDockCollapsed,
    setIsDockCollapsed,
    toggleDock,
  }), [
    activeEngine,
    setActiveEngine,
    canonicalVoice,
    stopOutput,
    stopSpeaking,
    cancelRequest,
    endConversation,
    micState,
    runtimeStatus,
    orbRuntimeState,
    activeConversationId,
    setActiveConversationId,
    conversationLanguage,
    selectedVoice,
    setSelectedVoice,
    handleLanguageChange,
    voiceInterimTranscript,
    composerText,
    handleComposerTextChange,
    handleVoiceTranscript,
    handleStreamDelta,
    handleAssistantDone,
    flushSpeechBuffer,
    workspaceContext,
    latestActionRecord,
    setLatestActionRecord,
    actionHistory,
    isDockCollapsed,
    toggleDock,
  ]);

  return (
    <JarvisRuntimeContext.Provider value={value}>
      {children}
    </JarvisRuntimeContext.Provider>
  );
};

const defaultFallbackVoice: any = {
  voiceState: 'idle',
  speaking: false,
  isSpeaking: false,
  startConversation: () => {},
  endConversation: () => {},
  stopSpeaking: () => {},
  speakProgressive: () => {},
  armSpeech: () => {},
  notifyManualEdit: () => {},
  notifyMicOff: () => {},
  setLanguage: () => {},
  setVoiceOverride: () => {},
  lastVoiceRejection: null,
  clearVoiceRejection: () => {},
  resetTurnLatch: () => {},
};

export function useJarvisRuntime(): JarvisRuntimeContextValue {
  const ctx = useContext(JarvisRuntimeContext);
  if (!ctx) {
    return {
      activeEngine: 'v1',
      setActiveEngine: () => {},
      voice: defaultFallbackVoice,
      voiceRef: { current: defaultFallbackVoice },
      stopOutput: () => {},
      stopSpeaking: () => {},
      cancelRequest: () => {},
      endConversation: () => {},
      lastVoiceRejection: null,
      clearVoiceRejection: () => {},
      beginOutput: () => 1,
      micState: 'idle',
      setMicState: () => {},
      runtimeStatus: { state: 'idle', elapsedMs: 0, firstTokenMs: null, provider: null, model: null, error: null },
      setRuntimeStatus: () => {},
      orbRuntimeState: 'idle',
      activeConversationId: null,
      setActiveConversationId: () => {},
      conversationLanguage: 'en',
      setConversationLanguage: () => {},
      selectedVoice: 'en-GB-RyanNeural',
      setSelectedVoice: () => {},
      handleLanguageChange: () => {},
      voiceInterimTranscript: '',
      setVoiceInterimTranscript: () => {},
      composerText: '',
      setComposerText: () => {},
      handleComposerTextChange: () => {},
      handleVoiceTranscript: () => {},
      handleStreamDelta: () => {},
      handleAssistantDone: () => {},
      flushSpeechBuffer: () => {},
      workspaceContext: {},
      setWorkspaceContext: () => {},
      latestActionRecord: null,
      setLatestActionRecord: () => {},
      actionHistory: [],
      activeChatRef: { current: null },
      turnSeqRef: { current: 0 },
      isDockCollapsed: false,
      setIsDockCollapsed: () => {},
      toggleDock: () => {},
    };
  }
  return ctx;
}
