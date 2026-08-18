import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../../api/client';
import { AlertCircle, Cpu, Server, User } from 'lucide-react';
import { JarvisComposer } from './JarvisComposer';
import type { MicState } from './JarvisComposer';
import { JarvisTeamPreviewCard } from './JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from './JarvisTeamExecutionCard';
import { JarvisGoalCard } from './JarvisGoalCard';
import { useCodexStore } from '../../store/codexStore';
import { useGatewayStream } from '../../hooks/useGatewayStream';
import { ProviderBadge } from '../gateway/ProviderBadge';
import { uiDiagnostics } from '../../diagnostics/uiSnapshot';
import { useBackendLifecycle } from '../../diagnostics/useBackendLifecycle';
import { voiceTraceBegin, voiceTracePush } from '../../diagnostics/voiceTrace';
import { voiceTimelinePush } from '../../diagnostics/voiceTimeline';
import { normalizeDomainTerms } from '../../lib/domainNormalization';
import { executionStore } from '../../diagnostics/executionStore';
import { ExecutionBar } from './ExecutionBar';
import { RoutingOverrideControl } from './RoutingOverrideControl';
import { GatewayNotice } from '../gateway/GatewayNotice';
import { GatewayEventTimeline } from '../gateway/GatewayEventTimeline';
import { GatewayRetryControls } from '../gateway/GatewayRetryControls';
import { ProviderDetailsPanel } from '../gateway/ProviderDetailsPanel';

import styles from '../../pages/JarvisStudio.module.css';

/**
 * Navigation targets JARVIS is allowed to open. Mirrors the existing
 * application route registry (src/App.tsx) plus the capability-registry
 * routes on the server; anything not listed here is rejected so a backend
 * event can never navigate the app somewhere unexpected.
 */
export const JARVIS_NAVIGATION_TARGETS = new Set<string>([
  '/jarvis',
  '/hermes',
  '/hermes-studio',
  '/codex',
  '/agent-teams',
  '/teams',
  '/mission-control',
  '/boards',
  '/research',
  '/files',
  '/memory',
  '/models',
  '/automations',
  '/settings',
  '/projects',
]);

export interface JarvisChatProps {
  conversationId: string | null;
  onStatusChange?: (status: JarvisRuntimeStatus) => void;
  onMessagesChange?: (messages: any[]) => void;
  onConversationCreated?: (id: string) => void;
  composerText?: string;
  onComposerTextChange?: (text: string) => void;
  /** When provided, the next message send will include this channel tag. */
  pendingInputChannel?: 'typed' | 'voice';
  /** Forwarded to the composer: real microphone capture state changes. */
  onMicStateChange?: (state: MicState) => void;
  /**
   * Fires EXACTLY ONCE per completed direct Jarvis reply (SSE `done` event),
   * with the full accumulated assistant text and the input channel that
   * originated the request. Consumers (e.g. TTS) must dedupe/guard further.
   */
  onAssistantResponse?: (text: string, inputChannel: 'typed' | 'voice') => void;
  /**
   * Progressive TTS hook: fires on every streamed assistant delta of a
   * DIRECT reply. When provided, the page owns speech (chunked, sequential)
   * and the one-shot `onAssistantResponse` speech trigger is skipped for
   * that turn — exactly one TTS path per reply, never both.
   */
  onStreamDelta?: (delta: string, inputChannel: 'typed' | 'voice') => void;
  /**
   * PHASE 15 (multi-turn reliability): fired when a voice-channel turn's
   * response cycle is TRULY over — every terminal stream path (done, error,
   * execution_failed, timeout, cancel, request failure) — regardless of
   * whether any audio was played. The conversation engine uses this to
   * re-arm the microphone deterministically (a delegated/empty/voice-off
   * reply must never leave the mic dead in 'thinking').
   */
  onResponseSettled?: () => void;
  /**
   * Navigation hook: fires when the backend emits a validated `navigation`
   * SSE event (e.g. "Open CodeX" → target `/codex`). Only supported internal
   * targets are forwarded; invalid/unknown targets are rejected here and
   * never reach the consumer. The navigation itself never touches task state.
   */
  onNavigate?: (target: string) => void;
  /**
   * Canonical-voice integration: when true the composer's OWN microphone
   * button is hidden — the page-level useVoiceIO engine is the single mic
   * owner (one microphone, one transcription path).
   */
  hideComposerMic?: boolean;
  /**
   * Visual variant for the command-center /jarvis page: 'command' renders
   * labeled monospace transcript lines (YOU / JARVIS / HERMES / CODEX /
   * REVIEWER / SYSTEM) instead of chat bubbles. Default 'chat' keeps the
   * existing bubble UI for every other consumer.
   */
  transcriptVariant?: 'chat' | 'command';
  /**
   * Final layout correction (§8): when true the routing row, ExecutionBar
   * and composer are NOT rendered inside the transcript dock — the page
   * hosts a sticky composer at the bottom of the center column instead, so
   * "Ask Jarvis anything…" can never disappear below the fold.
   */
  hideComposer?: boolean;
}

/** Imperative API — lets the single canonical voice engine auto-submit a
 *  transcribed turn through the exact same streaming pipeline as Send. */
export interface JarvisChatHandle {
  sendMessage: (text: string, inputChannel?: 'typed' | 'voice') => void;
  /** Final layout correction (§8): the sticky page-level composer cancels
   *  the in-flight response through the same pipeline as the inline one. */
  cancelResponse: () => void;
}

export type JarvisRuntimeState = 'idle' | 'understanding' | 'planning' | 'delegating' | 'executing' | 'reviewing' | 'thinking' | 'streaming' | 'approval_required' | 'paused' | 'completed' | 'error' | 'cancelled';

export interface JarvisRuntimeStatus {
  state: JarvisRuntimeState;
  elapsedMs: number;
  firstTokenMs?: number | null;
  provider?: string | null;
  model?: string | null;
  error?: string | null;
}

interface SendErrorState {
  message: string;
  operationId: string;
}

const FIRST_TOKEN_TIMEOUT_MS = 45_000;  // starts AFTER fetch() headers are received
const TOTAL_RESPONSE_TIMEOUT_MS = 120_000;
const DEV_TIMING = import.meta.env.DEV;

const getMessageOperationId = (message: any): string | undefined => {
  const operationId = message?.metadata?.operationId;
  return typeof operationId === 'string' && operationId.length > 0 ? operationId : undefined;
};

const visibleMessagesForOperations = (messages: any[]) => {
  const seenUserOperations = new Set<string>();
  const seenAgentOperations = new Set<string>();
  const seenErrorOperations = new Set<string>();
  return messages.filter(message => {
    const operationId = getMessageOperationId(message);
    if (message.role === 'user' && operationId) {
      if (seenUserOperations.has(operationId)) return false;
      seenUserOperations.add(operationId);
      return true;
    }
    if (message.role === 'agent' && operationId) {
      if (seenAgentOperations.has(operationId)) return false;
      seenAgentOperations.add(operationId);
      return true;
    }
    if (message.messageType !== 'error') return true;
    if (!operationId) return true;
    if (seenErrorOperations.has(operationId)) return false;
    seenErrorOperations.add(operationId);
    return true;
  });
};

function parseSseFrames(buffer: string) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() || '';
  return {
    rest,
    events: frames.map(frame => {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      return { event, data };
    })
  };
}

const idleStatus: JarvisRuntimeStatus = {
  state: 'idle',
  elapsedMs: 0,
  firstTokenMs: null,
  provider: null,
  model: null,
  error: null
};

/**
 * Classify the runtime state after a stream `done` event.
 *
 * Synchronous terminal conversation routes (direct, memory_store,
 * memory_recall, decision_statement, continuation, project_state_answer,
 * clarification_required, and investigate replies without a delegation
 * status) are COMPLETED — they release the composer. Only genuine
 * delegations carry a status (from execution_* events) and stay
 * 'executing' until execution_completed/execution_failed arrives.
 */
export function classifyDoneState(data: { route?: string; status?: string | null }): JarvisRuntimeState {
  const isTerminalConversation =
    !data.route ||
    data.route === 'direct' ||
    data.route === 'clarification_required' ||
    (data.route === 'investigate' && !data.status) ||
    !data.status;
  return isTerminalConversation ? 'completed' : runtimeStateForDelegatedStatus(data.status ?? undefined);
}

const runtimeStateForDelegatedStatus = (status?: string): JarvisRuntimeState => {
  if (status === 'waiting_for_approval' || status === 'awaiting_approval') return 'approval_required';
  if (status === 'planning' || status === 'queued') return 'executing';
  if (status === 'running' || status === 'executing') return 'executing';
  if (status === 'paused') return 'paused';
  if (status === 'failed') return 'error';
  if (status === 'completed') return 'completed';
  return 'executing';
};

export const JarvisChat = React.forwardRef<JarvisChatHandle, JarvisChatProps>(({
  conversationId,
  onStatusChange,
  onMessagesChange,
  onConversationCreated,
  composerText,
  onComposerTextChange,
  pendingInputChannel,
  onMicStateChange,
  onAssistantResponse,
  onStreamDelta,
  onNavigate,
  onResponseSettled,
  hideComposerMic,
  transcriptVariant = 'chat',
  hideComposer = false,
}, ref) => {
  const { runSettings } = useCodexStore();
  const [messages, setMessages] = useState<any[]>([]);

  // Diagnostic: report the most recent transcript ProviderBadge value (what
  // the UI is actually displaying for the last gateway-bearing message).
  useEffect(() => {
    const lastBadge = [...messages].reverse().find((m: any) => m?.gateway?.provider);
    if (lastBadge) {
      uiDiagnostics.setFrontendBadge(
        lastBadge.gateway.provider ?? null,
        lastBadge.gateway.model ?? null,
        lastBadge.id ?? null
      );
    }
    // Unmount marker: the value stays as last-known, but the component is no
    // longer mounted (remounts must not erase valid diagnostic state).
    return () => { uiDiagnostics.setFrontendBadgeUnmounted(); };
  }, [messages]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendError, setSendError] = useState<SendErrorState | null>(null);

  // ── Backend lifecycle gate (backend lifecycle milestone) ──────────────
  // Jarvis never pretends to process requests when the backend APIs are
  // definitively down (offline/failed). The gate activates on the
  // AUTHORITATIVE lifecycle source (Electron IPC in the desktop app); in
  // plain browser dev mode the AppShell startup/error screens own the
  // offline experience instead. Transient states (starting/reconnecting)
  // keep the composer usable — the lifecycle manager may be mid-restart and
  // the very next send can succeed. The gate message is the user-facing
  // contract from the milestone spec.
  const backendLifecycle = useBackendLifecycle();
  const backendDefinitivelyDown =
    backendLifecycle.status === 'offline' || backendLifecycle.status === 'failed';
  const offlineGateReason =
    backendLifecycle.source === 'electron' && backendDefinitivelyDown
      ? backendLifecycle.status === 'offline'
        ? (backendLifecycle.mode === 'EXTERNAL'
          ? 'AgenticOS backend is offline — waiting for the external backend.'
          : 'AgenticOS backend is offline. Reconnecting now…')
        : 'The backend could not be restored automatically. Open diagnostics (top bar) or retry.'
      : null;
  const offlineGateReasonRef = useRef<string | null>(offlineGateReason);
  useEffect(() => {
    offlineGateReasonRef.current = offlineGateReason;
  }, [offlineGateReason]);
  const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
  const [detailsMessage, setDetailsMessage] = useState<any | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // ── Transcript scroll ownership (layout-stability milestone) ──
  // The transcript scrolls INSIDE its bounded dock. Auto-follow only while
  // the user is near the bottom; a manual scroll-up is never force-jumped
  // back — a "Jump to latest" control appears instead (§4).
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const handleTranscriptScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 140;
    stickToBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom && messages.length > 0);
  };
  const jumpToLatest = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  };
  const abortControllerRef = useRef<AbortController | null>(null);
  const firstTokenTimerRef = useRef<number | null>(null);
  const totalResponseTimerRef = useRef<number | null>(null);
  const responseTimedOutRef = useRef(false);
  const requestStartedAtRef = useRef<number | null>(null);
  const statusIntervalRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  // Exactly-once guard for navigation events: keyed by operationId+target so
  // the same navigation event is never forwarded twice (the stream loop can
  // flush the same SSE frame list in two passes).
  const firedNavigationRef = useRef<Set<string>>(new Set());
  // ── TTS trigger bookkeeping ─────────────────────────────────────────────
  // Input channel of the in-flight request ('voice' → reply may be spoken).
  const pendingChannelRef = useRef<'typed' | 'voice'>('typed');
  // Accumulated streamed assistant text per operation, read exactly once at
  // the SSE `done` event so the reply is handed to TTS a single time.
  const streamedTextByOpRef = useRef<Record<string, string>>({});
  const onAssistantResponseRef = useRef(onAssistantResponse);
  const onStreamDeltaRef = useRef(onStreamDelta);
  const onResponseSettledRef = useRef(onResponseSettled);
  /** operationId → conversationId used for that stream (first turn of a fresh
   *  conversation creates a NEW id that the prop hasn't propagated yet). */
  const opConversationRef = useRef<Record<string, string>>({});
  useEffect(() => {
    onAssistantResponseRef.current = onAssistantResponse;
  }, [onAssistantResponse]);
  useEffect(() => {
    onStreamDeltaRef.current = onStreamDelta;
  }, [onStreamDelta]);
  useEffect(() => {
    onResponseSettledRef.current = onResponseSettled;
  }, [onResponseSettled]);

  // Sync isProcessing to ref
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);
  const runtimeStateRef = useRef<JarvisRuntimeState>('idle');
  const firstTokenMsRef = useRef<number | null>(null);
  // Durable error for the BLOCKED/ATTENTION surface: the status clock re-emits
  // status every 250ms and must not clobber a model/provider failure with a
  // null error between ticks. Cleared explicitly when a new request starts.
  const errorRef = useRef<string | null>(null);
  const lastOperationIdRef = useRef<string | null>(null);
  const [routingOverride, setRoutingOverride] = useState<{ provider: string | null; model: string | null; mode: 'auto' | 'manual' }>({ provider: null, model: null, mode: 'auto' });

  const emitStatus = (patch: Partial<JarvisRuntimeStatus>) => {
    const elapsedMs = requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : 0;
    if (patch.state) runtimeStateRef.current = patch.state;
    if (patch.firstTokenMs !== undefined) firstTokenMsRef.current = patch.firstTokenMs ?? null;
    // Persist an explicit error (and explicit null clears it); the clock ticks
    // that only carry { state } must not erase a surfaced failure.
    if (patch.error !== undefined) errorRef.current = patch.error;
    onStatusChange?.({
      state: 'idle',
      elapsedMs,
      firstTokenMs: firstTokenMsRef.current,
      provider: null,
      model: null,
      error: errorRef.current,
      ...patch
    });
  };

  const clearResponseTimers = () => {
    if (firstTokenTimerRef.current !== null) {
      window.clearTimeout(firstTokenTimerRef.current);
      firstTokenTimerRef.current = null;
    }
    if (totalResponseTimerRef.current !== null) {
      window.clearTimeout(totalResponseTimerRef.current);
      totalResponseTimerRef.current = null;
    }
  };

  const startStatusClock = (state: JarvisRuntimeState) => {
    if (statusIntervalRef.current !== null) window.clearInterval(statusIntervalRef.current);
    emitStatus({ state });
    statusIntervalRef.current = window.setInterval(() => emitStatus({ state: runtimeStateRef.current }), 250);
  };

  const stopStatusClock = () => {
    if (statusIntervalRef.current !== null) {
      window.clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
  };

  // STOP propagation and Goal terminal synchronization:
  useEffect(() => {
    const handleGoalTerminal = () => {
      stopStatusClock();
      clearResponseTimers();
      runtimeStateRef.current = 'idle';
      isProcessingRef.current = false;
      setIsProcessing(false);
      emitStatus({ ...idleStatus, state: 'idle' });
    };
    window.addEventListener('jarvis:goal-terminal', handleGoalTerminal);
    return () => {
      window.removeEventListener('jarvis:goal-terminal', handleGoalTerminal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchMessages = async (merge = false) => {
    if (!conversationId) {
      setMessages([]);
      onMessagesChange?.([]);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/jarvis/conversations/${conversationId}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) {
        if (merge) {
          setMessages(prev => {
            const existingIds = new Set(prev.map(message => message.id));
            return [...prev, ...data.filter((message: any) => !existingIds.has(message.id))];
          });
        } else {
          setMessages(data);
        }
      } else {
        console.error('Expected array of messages, got:', data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchMessages();
    if (!isProcessingRef.current) {
      setCreatedGoalId(null);
      setSendError(null);
      requestStartedAtRef.current = null;
      emitStatus(idleStatus);
    }
  }, [conversationId]);

  useGatewayStream({
    conversationId,
    onMessage: (data) => {
      setMessages(prev => {
        if (prev.find(p => p.id === data.id)) return prev;
        return [...prev, data];
      });
    },
    onGatewayEvent: (messageId, event, metadataUpdate) => {
      // Find the message by ID or fallback to the latest active operation
      setMessages(prev => {
        const next = [...prev];
        let targetIndex = -1;
        
        if (messageId) {
          targetIndex = next.findIndex(m => m.id === messageId);
        } else {
          // Find the last agent message
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'agent') {
              targetIndex = i;
              break;
            }
          }
        }
        
        if (targetIndex >= 0) {
          const m = next[targetIndex];
          const prevGateway = m.gateway || {};
          const newGateway = { ...prevGateway, ...metadataUpdate };
          if (event) {
            const prevEvents = prevGateway.events || [];
            newGateway.events = [...prevEvents, event].slice(-20);
          }
          next[targetIndex] = { ...m, gateway: newGateway };
        }
        return next;
      });
    }
  });

  useEffect(() => {
    // Follow new content only while the user is already near the bottom —
    // reading history is never interrupted (§4).
    if (stickToBottomRef.current && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        logAbort('component_unmount', abortControllerRef.current, requestStartedAtRef.current);
        abortControllerRef.current.abort();
      }
      clearResponseTimers();
      if (statusIntervalRef.current !== null) window.clearInterval(statusIntervalRef.current);
    };
  }, []);

  const logAbort = (reason: string, controller: AbortController, startTime: number | null, extraOpId?: string) => {
    // If the controller is already aborted, don't double log
    if (controller.signal.aborted) return;
    const elapsed = startTime ? Date.now() - startTime : -1;
    // We try to extract operationId from the currently tracked one if we know it
    console.debug(`[JarvisChat:abort] reason=${reason} operationId=${extraOpId || 'unknown'} conversationId=${conversationId} elapsed=${elapsed}ms`);
  };

  const activeGoalId = useMemo(() => {
    if (createdGoalId) return createdGoalId;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].goalId) return messages[i].goalId as string;
    }
    return null;
  }, [createdGoalId, messages]);

  const latestTeamExecutionMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].messageType === 'team_execution' && messages[i].runId) return messages[i].id;
    }
    return null;
  }, [messages]);

  const visibleMessages = useMemo(() => visibleMessagesForOperations(messages), [messages]);
  const sendErrorHiddenByMessage = useMemo(() => {
    if (!sendError) return false;
    return messages.some(message => (
      message.messageType === 'error'
      && getMessageOperationId(message) === sendError.operationId
    ));
  }, [messages, sendError]);



  const appendStreamingAssistantText = (operationId: string, delta: string, final = false) => {
    // Track the accumulated text for the TTS trigger (read once at `done`).
    if (delta) {
      streamedTextByOpRef.current[operationId] =
        `${streamedTextByOpRef.current[operationId] || ''}${delta}`;
    }
    setMessages(prev => {
      const existingIndex = prev.findIndex(p => p.id === `assistant-${operationId}`);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          content: `${next[existingIndex].content}${delta}`,
          status: final ? 'completed' : 'streaming',
          updatedAt: new Date().toISOString()
        };
        return next;
      }
      if (!delta) return prev;
      return [...prev, {
        id: `assistant-${operationId}`,
        role: 'agent',
        content: delta,
        status: final ? 'completed' : 'streaming',
        routedAgent: 'jarvis',
        createdAt: new Date().toISOString(),
        metadata: { operationId }
      }];
    });
  };

  const appendOperationalEvent = (operationId: string, eventName: string, content: string, metadata: Record<string, any> = {}) => {
    const id = `op-${operationId}-${eventName}`;
    setMessages(prev => {
      const nextMessage = {
        id,
        role: 'system',
        messageType: eventName === 'plan' ? 'plan' : eventName === 'approval_required' ? 'approval_request' : 'system_status',
        content,
        createdAt: new Date().toISOString(),
        metadata: { operationId, eventName, ...metadata }
      };
      const existingIndex = prev.findIndex(p => p.id === id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextMessage;
        return next;
      }
      return [...prev, nextMessage];
    });
  };

  const cancelResponse = () => {
    responseTimedOutRef.current = false;
    if (abortControllerRef.current) {
      logAbort('user_cancel', abortControllerRef.current, requestStartedAtRef.current);
      abortControllerRef.current.abort();
    }
    clearResponseTimers();
    stopStatusClock();
    emitStatus({ state: 'cancelled' });
    // PHASE 15 (multi-turn reliability): a cancelled response is still a
    // settled response — the conversation engine must re-arm the mic so the
    // next voice turn works after STOP/barge-in.
    onResponseSettledRef.current?.();
    uiDiagnostics.setStreamEnded(null);
    window.setTimeout(() => {
      if (!abortControllerRef.current) emitStatus(idleStatus);
    }, 1200);
    setIsProcessing(false);
  };

  const buildMessageRequestBody = (text: string, operationId: string, inputChannel: 'typed' | 'voice' = 'typed') => {
    const body: {
      prompt: string;
      operationId: string;
      inputChannel: 'typed' | 'voice';
      workspacePath?: string;
      repositoryPath?: string;
      approvalPolicy?: string;
      overrideProvider?: string;
      overrideModel?: string;
    } = { prompt: text, operationId, inputChannel };

    // Conversation-level routing override (PRIORITY 3): manual selections
    // apply only to this execution; the backend records them in the ledger.
    if (routingOverride.mode === 'manual' && routingOverride.provider) {
      body.overrideProvider = routingOverride.provider;
      if (routingOverride.model) body.overrideModel = routingOverride.model;
    }

    if (runSettings.workspacePath) {
      body.workspacePath = runSettings.workspacePath;
      body.repositoryPath = runSettings.workspacePath;
      body.approvalPolicy = runSettings.approvalPolicy;
    }

    return body;
  };

  const handleSendMessage = async (text: string, inputChannel: 'typed' | 'voice' = pendingInputChannel ?? 'typed') => {
    // Offline gate: never route a request into Jarvis logic while the
    // backend is definitively unavailable — answer truthfully instead.
    if (offlineGateReasonRef.current) {
      setMessages(prev => [...prev, {
        id: `offline-${Date.now()}`,
        role: 'agent',
        content: offlineGateReasonRef.current,
        createdAt: new Date().toISOString(),
        metadata: { offlineGate: true },
      }]);
      setIsProcessing(false);
      return;
    }
    // Track the input channel so the completed reply can be routed to TTS.
    pendingChannelRef.current = inputChannel;
    voiceTraceBegin();
    // Domain grounding: normalize Agentic-OS STT variants ("Authentic OS",
    // "Argentic OS", "Agenticos") back to the local project name when the
    // context is a project/architecture reference. Never rewrite unrelated
    // user words.
    text = normalizeDomainTerms(text);
    // ── Dev timing telemetry ──────────────────────────────────────────
    const t0 = Date.now();
    if (DEV_TIMING) console.debug('[JarvisChat:timing] submit', { text: text.slice(0, 40), inputChannel, t: t0 });
    let targetConversationId = conversationId;
    if (!targetConversationId) {
      try {
        const createRes = await fetch(`${API_BASE}/jarvis/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 40) || 'New Conversation' }),
        });
        const createData = await createRes.json();
        if (createData?.id) {
          targetConversationId = createData.id;
          onConversationCreated?.(createData.id);
        } else {
          throw new Error('Failed to create a new conversation');
        }
      } catch (err: any) {
        setSendError({ message: err.message || 'Failed to create conversation', operationId: `err-${Date.now()}` });
        setIsProcessing(false);
        return;
      }
    }
    voiceTracePush('conversation', 'ok', `Conversation ${targetConversationId} (channel ${inputChannel})`);

    const operationId = `jarvis-${targetConversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Guaranteed non-null here (created above when missing), but TS can't
    // narrow a `let` through the await — record the actual id for the TTS
    // fallback fetch of non-streamed replies.
    opConversationRef.current[operationId] = targetConversationId || '';
    lastOperationIdRef.current = operationId;
    if (abortControllerRef.current) {
      logAbort('new_request', abortControllerRef.current, requestStartedAtRef.current, operationId);
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    responseTimedOutRef.current = false;
    requestStartedAtRef.current = Date.now();
    firstTokenMsRef.current = null;
    setCreatedGoalId(null);
    setIsProcessing(true);
    setSendError(null);
    errorRef.current = null;
    clearResponseTimers();
    startStatusClock('thinking');

    // NOTE: First-token timer is NOT started here.
    // It is started AFTER fetch() resolves with HTTP headers so that
    // conversation-creation overhead and network round-trip do NOT eat
    // into the budget.  See the 'fetch-start' telemetry point below.

    totalResponseTimerRef.current = window.setTimeout(() => {
      if (abortControllerRef.current !== controller) return;
      responseTimedOutRef.current = true;
      logAbort('overall_timeout', controller, requestStartedAtRef.current, operationId);
      controller.abort();
      setSendError({ message: 'Jarvis response timed out before completion.', operationId });
      stopStatusClock();
      emitStatus({ state: 'error', error: 'Jarvis response timed out before completion.' });
      setIsProcessing(false);
      onResponseSettledRef.current?.();
    }, TOTAL_RESPONSE_TIMEOUT_MS);

    setMessages(prev => [...prev, {
      id: operationId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      metadata: { operationId, inputChannel }
    }]);

    try {
      const fetchStartAt = Date.now();
      if (DEV_TIMING) console.debug('[JarvisChat:timing] fetch-start', { operationId, inputChannel, ms: fetchStartAt - t0 });
      voiceTimelinePush('modelRequestStartAt', `"${text.slice(0, 40)}"`);

      const res = await fetch(`${API_BASE}/jarvis/conversations/${targetConversationId}/message/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(buildMessageRequestBody(text, operationId, inputChannel))
      });

      // ── First-token timer starts HERE — after headers are received ──
      const headersReceivedAt = Date.now();
      if (DEV_TIMING) console.debug('[JarvisChat:timing] headers-received', { operationId, status: res.status, ms: headersReceivedAt - fetchStartAt });

      firstTokenTimerRef.current = window.setTimeout(() => {
        if (abortControllerRef.current !== controller) return;
        responseTimedOutRef.current = true;
        logAbort('first_token_timeout', controller, fetchStartAt, operationId);
        controller.abort();
        setSendError({ message: 'Jarvis provider timed out before first token.', operationId });
        stopStatusClock();
        emitStatus({ state: 'error', error: 'Jarvis provider timed out before first token.' });
        setIsProcessing(false);
        onResponseSettledRef.current?.();
      }, FIRST_TOKEN_TIMEOUT_MS);

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      if (!res.body) {
        await sendLegacyMessage(text, operationId, controller, inputChannel);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawTextChunk = false;
      let sawTerminalEvent = false;
      let sawFirstChunk = false;
      let firstChunkAt = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // AUTHORITATIVE STOP: after abort, no further SSE frame may be
        // processed — late old-turn tokens are discarded at the boundary.
        if (controller.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        sawTerminalEvent = sawTerminalEvent || parsed.events.some(event => ['done', 'error', 'execution_failed', 'cancelled'].includes(event.event));
        if (!sawFirstChunk && parsed.events.some(e => e.event === 'chunk')) {
          sawFirstChunk = true;
          firstChunkAt = Date.now();
          if (firstTokenTimerRef.current !== null) {
            window.clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
          }
          if (DEV_TIMING) console.debug('[JarvisChat:timing] first-chunk', { operationId, ms: firstChunkAt - headersReceivedAt });
        }
        sawTextChunk = await handleStreamEvents(parsed.events, operationId, sawTextChunk);
      }

      buffer += decoder.decode();
      const parsed = parseSseFrames(`${buffer}\n\n`);
      sawTerminalEvent = sawTerminalEvent || parsed.events.some(event => ['done', 'error', 'execution_failed', 'cancelled'].includes(event.event));
      await handleStreamEvents(parsed.events, operationId, sawTextChunk);

      if (DEV_TIMING) console.debug('[JarvisChat:timing] stream-done', { operationId, sawTerminalEvent, ms: Date.now() - (sawFirstChunk ? firstChunkAt : headersReceivedAt) });

      if (!sawTerminalEvent && !controller.signal.aborted) {
        const message = 'Jarvis stream closed before sending a completion or error event.';
        setSendError({ message, operationId });
        emitStatus({ state: 'error', error: message });
        await fetchMessages(true);
      }
    } catch (e: any) {
      if (DEV_TIMING) console.debug('[JarvisChat:timing] stream-error', { operationId, error: e?.message, ms: Date.now() - t0 });
      if (controller.signal.aborted && !responseTimedOutRef.current) {
        appendStreamingAssistantText(operationId, '\n\n[Response cancelled]', true);
        delete streamedTextByOpRef.current[operationId];
        emitStatus({ state: 'cancelled', error: null });
      } else if (!sendError) {
        const message = `Could not reach the backend: ${e.message || e}`;
        setSendError({ message, operationId });
        emitStatus({ state: 'error', error: message });
      }
    } finally {
      clearResponseTimers();
      stopStatusClock();
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsProcessing(false);
    }
  };

  // Canonical voice engine auto-submits transcribed turns through the exact
  // same streaming pipeline the Send button uses (one response-stream path).
  // NOTE: the imperative handle MUST NOT close over the first render's
  // closures. `handleSendMessage` and `cancelResponse` read current props
  // (notably `conversationId`), which are set AFTER mount by the studio's
  // restore effect — a `[]`-deps handle would capture `conversationId === null`
  // forever and force every typed/voice send to auto-create a NEW conversation
  // (follow-up turns lost context; live acceptance showed T1→conv-A, T2→conv-B).
  const handleSendRef = useRef<((text: string, channel: 'typed' | 'voice') => void) | null>(null);
  handleSendRef.current = (text: string, channel: 'typed' | 'voice') => { void handleSendMessage(text, channel); };
  const cancelResponseRef = useRef<(() => void) | null>(null);
  cancelResponseRef.current = () => cancelResponse();
  React.useImperativeHandle(ref, () => ({
    sendMessage: (text: string, inputChannel: 'typed' | 'voice' = 'voice') => {
      handleSendRef.current?.(text, inputChannel);
    },
    cancelResponse: () => cancelResponseRef.current?.(),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendLegacyMessage = async (text: string, operationId: string, controller: AbortController, inputChannel: 'typed' | 'voice' = 'typed') => {
    const fallbackRes = await fetch(`${API_BASE}/jarvis/conversations/${conversationId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(buildMessageRequestBody(text, operationId, inputChannel))
    });
    const result = await fallbackRes.json().catch(() => ({}));

    if (!fallbackRes.ok || result?.error) {
      if (result?.route) {
        await fetchMessages();
      } else {
        setSendError({ message: result?.error || `Request failed (${fallbackRes.status})`, operationId });
      }
    } else if (result?.route === 'codex' && result?.goalId) {
      setCreatedGoalId(result.goalId);
    }
  };

  const handleStreamEvents = async (events: Array<{ event: string; data: string }>, operationId: string, sawTextChunk: boolean) => {
    let nextSawTextChunk = sawTextChunk;
    for (const event of events) {
      // Hard turn invalidation: a cancelled stream must never process the
      // events that were already buffered when the abort landed.
      if (abortControllerRef.current?.signal.aborted) break;
      const data = event.data ? JSON.parse(event.data) : {};
      if (event.event === 'intent') {
        emitStatus({ state: data.mode === 'operational_execution' ? 'understanding' : 'thinking' });
        appendOperationalEvent(
          operationId,
          'intent',
          `Intent: ${data.type}${data.route ? ` (${data.route})` : ''}${data.reason ? ` - ${data.reason}` : ''}`,
          data
        );
      } else if (event.event === 'plan') {
        emitStatus({ state: 'planning' });
        const steps = Array.isArray(data.steps) ? data.steps : [];
        appendOperationalEvent(
          operationId,
          'plan',
          `Plan:\n${steps.map((step: string, index: number) => `${index + 1}. ${step}`).join('\n')}`,
          data
        );
      } else if (event.event === 'agent_selected') {
        emitStatus({ state: 'delegating' });
        appendOperationalEvent(operationId, 'agent_selected', `Selected agent: ${data.agent}${data.reason ? ` - ${data.reason}` : ''}`, data);
      } else if (event.event === 'navigation') {
        // Only forward supported internal targets; reject everything else so a
        // backend event can never navigate somewhere unexpected. Navigation is
        // a pure UI action — it never touches background-task state. The
        // exactly-once guard prevents a duplicate forward when the stream
        // loop processes the same frame list twice.
        const target = typeof data.target === 'string' ? data.target : '';
        if (JARVIS_NAVIGATION_TARGETS.has(target)) {
          const navKey = `${operationId}:${target}`;
          if (!firedNavigationRef.current.has(navKey)) {
            firedNavigationRef.current.add(navKey);
            appendOperationalEvent(operationId, 'navigation', `Opening ${target}`, data);
            onNavigate?.(target);
          }
        } else {
          appendOperationalEvent(operationId, 'navigation', `Navigation rejected: unsupported target "${target || data.capability || 'unknown'}"`, data);
        }
      } else if (event.event === 'approval_required') {
        emitStatus({ state: 'approval_required' });
        appendOperationalEvent(
          operationId,
          'approval_required',
          `Approval required: ${data.reason}\nAction: ${data.proposedAction}${data.workspace ? `\nWorkspace: ${data.workspace}` : ''}`,
          data
        );
      } else if (event.event === 'execution_started') {
        emitStatus({ state: 'executing' });
        appendOperationalEvent(operationId, 'execution_started', `Execution started: ${data.agent || data.route}`, data);
      } else if (event.event === 'execution_progress') {
        emitStatus({ state: runtimeStateForDelegatedStatus(data.status || data.state) });
        appendOperationalEvent(operationId, 'execution_progress', `Execution status: ${data.state || data.status || 'running'}`, data);
      } else if (event.event === 'execution_completed') {
        emitStatus({ state: 'completed' });
        appendOperationalEvent(
          operationId,
          'execution_completed',
          `Execution completed${data.goalId ? `\nCodeX goal: ${data.goalId}` : ''}${data.teamId ? `\nTeam: ${data.teamId}` : ''}${data.status ? `\nStatus: ${data.status}` : ''}`,
          data
        );
      } else if (event.event === 'execution_failed') {
        emitStatus({ state: 'error', error: data.error || 'Execution failed.' });
        uiDiagnostics.setStreamEnded(operationId);
        onResponseSettledRef.current?.();
        appendOperationalEvent(operationId, 'execution_failed', `Execution failed: ${data.error || 'Unknown error'}`, data);
      } else if (event.event === 'paused') {
        emitStatus({ state: 'paused' });
        appendOperationalEvent(operationId, 'paused', `Execution paused${data.reason ? `: ${data.reason}` : ''}`, data);
      } else if (event.event === 'intent') {
        voiceTracePush('intent_route', 'ok', `Intent ${data.type || data.route || '?'} (${Math.round((data.confidence || 0) * 100)}%)`);
      } else if (event.event === 'timing' && data.marker === 'first_token') {
        voiceTracePush('provider_model', 'ok', `${data.provider} / ${data.model} — first token in ${data.elapsedMs}ms`);
        if (typeof data.elapsedMs === 'number') firstTokenMsRef.current = data.elapsedMs;
        if (firstTokenTimerRef.current !== null) {
          window.clearTimeout(firstTokenTimerRef.current);
          firstTokenTimerRef.current = null;
        }
      } else if (event.event === 'chunk') {
        if (nextSawTextChunk === false) {
          voiceTracePush('response_started', 'ok', 'Response stream started');
          voiceTimelinePush('firstModelTokenAt', `"${(data.delta || '').slice(0, 30)}"`);
        }
        nextSawTextChunk = true;
        if (firstTokenTimerRef.current !== null) {
          window.clearTimeout(firstTokenTimerRef.current);
          firstTokenTimerRef.current = null;
        }
        emitStatus({
          state: 'streaming',
          firstTokenMs: firstTokenMsRef.current,
          provider: data.provider ?? null,
          model: data.model ?? null
        });
        // Model/provider failure (HTTP 402 etc.) arrives as a token chunk
        // whose content starts with "[Stream Error: …]" (llmGateway swallows
        // the router failure into a token). Surface it in the runtime error
        // state so the BLOCKED/ATTENTION row shows the failure durably until
        // the next request — the transcript copy is the chunk itself.
        if (typeof data.delta === 'string' && data.delta.includes('[Stream Error:')) {
          const errMsg = data.delta.replace(/^[\s\n]*\[Stream Error:\s*/, '').replace(/\]\s*$/, '').trim() || 'Stream error.';
          emitStatus({ state: 'error', error: errMsg.slice(0, 200) });
        }
        // Diagnostic: report what the UI is streaming (current active stream).
        uiDiagnostics.setStreamActive(data.provider ?? null, data.model ?? null, operationId);
        appendStreamingAssistantText(operationId, data.delta || '');
        if (data.delta) onStreamDeltaRef.current?.(data.delta, pendingChannelRef.current);
      } else if (event.event === 'error') {
        const message = data.error || 'Jarvis response failed.';
        setSendError({ message, operationId });
        emitStatus({ state: 'error', error: message });
        uiDiagnostics.setStreamEnded(operationId);
        onResponseSettledRef.current?.();
        await fetchMessages();
      } else if (event.event === 'done') {
        voiceTracePush('response_done', 'ok', `Stream done (route ${data.route || 'direct'})`);
        // PHASE 15 (multi-turn reliability, Failure A): the response cycle is
        // over — even if this turn played no audio (delegated route, empty
        // reply, voice disabled), the conversation engine re-arms the mic.
        onResponseSettledRef.current?.();
        appendStreamingAssistantText(operationId, '', true);
        // ── TTS trigger: fires EXACTLY ONCE per completed DIRECT Jarvis reply.
        //    Delegated (CodeX/team), telemetry and system messages never reach
        //    this point with streamed text; the consumer gates on the channel. ──
        const finalText = (streamedTextByOpRef.current[operationId] || '').trim();
        const hadStreamedText = finalText.length > 0;
        delete streamedTextByOpRef.current[operationId];
        if (!data.route || data.route === 'direct') {
          if (hadStreamedText) {
            // One-shot TTS only when the page did NOT take the progressive path.
            if (!onStreamDeltaRef.current) {
              onAssistantResponseRef.current?.(finalText, pendingChannelRef.current);
            }
          } else if (onStreamDeltaRef.current) {
            // EMERGENCY FIX: a DIRECT reply served WITHOUT streamed chunks
            // (e.g. the first reply of a fresh conversation) produced no
            // deltas, so the progressive path never fired and the one-shot
            // was skipped — the user gets text but never a spoken reply.
            // The reply text is persisted; load it and speak ONCE (the
            // consumer's VOICE ON/OFF gate still applies inside speak()).
            void (async () => {
              try {
                const convId = opConversationRef.current[operationId] || conversationId;
                delete opConversationRef.current[operationId];
                const res = await fetch(`${API_BASE}/jarvis/conversations/${convId}/messages`);
                const msgs = await res.json();
                if (Array.isArray(msgs)) {
                  const lastAgent = msgs.slice().reverse().find((m: any) => m?.role === 'assistant' || m?.role === 'agent');
                  const t = lastAgent ? String(lastAgent.content || '').trim() : '';
                  if (t) onAssistantResponseRef.current?.(t, pendingChannelRef.current);
                }
              } catch { /* best effort — visible text already delivered */ }
            })();
          }
        }
        if (data.goalId) setCreatedGoalId(data.goalId);
        // Current-turn ownership: a background task created by THIS operation
        // is announced so the Active Task panel selects it (never a stale
        // historical task) and pins it as the current operation.
        if (data.taskId) {
          window.dispatchEvent(new CustomEvent('jarvis:task-created', {
            detail: { taskId: data.taskId, operationId }
          }));
        }
        // §stabilization: clarification_required is a TERMINAL conversation
        // state (Jarvis is waiting for the user), NOT a delegated execution.
        // Treating it as delegated left runtimeStatus stuck in 'executing',
        // which disabled the composer forever. Terminal conversation routes
        // complete like 'direct' and release the composer via the idle timer.
        // Same for a SYNCHRONOUS 'investigate' reply (registry state report):
        // its done frame carries no status and ends the stream — it is
        // completed, not a still-executing delegation. (Async delegations —
        // codex/hermes — carry data.status from execution_* events.) The
        // classifier also treats every route WITHOUT a delegation status as
        // terminal — memory_store / memory_recall / decision_statement /
        // continuation / project_state_answer all complete synchronously and
        // must release the composer.
        const nextState = classifyDoneState(data);
        emitStatus({
          state: nextState,
          firstTokenMs: typeof data.firstTokenMs === 'number' ? data.firstTokenMs : firstTokenMsRef.current,
          provider: data.provider ?? null,
          model: data.model ?? null
        });
        // Diagnostic: the stream ended — move active → lastKnown.
        uiDiagnostics.setStreamEnded(operationId);
        stopStatusClock();
        clearResponseTimers();
        isProcessingRef.current = false;
        setIsProcessing(false);
        window.setTimeout(() => {
          if (!abortControllerRef.current) {
            // Reset to idle (recovery shown — never stuck in the error
            // state) but preserve a surfaced model/provider failure so the
            // BLOCKED/ATTENTION row keeps showing it until the next request.
            emitStatus({ ...idleStatus, error: errorRef.current });
          }
        }, 800);
        if (data.route !== 'direct' || !nextSawTextChunk) await fetchMessages(true);
        if (data.route === 'codex' && data.goalId) setCreatedGoalId(data.goalId);
      }
    }
    return nextSawTextChunk;
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split('```');
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const firstLineBreak = part.indexOf('\n');
        const code = firstLineBreak > -1 ? part.substring(firstLineBreak + 1) : part;
        return <pre key={i} style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '6px', overflowX: 'auto', marginTop: '8px', marginBottom: '8px' }}><code>{code}</code></pre>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <>
      {/* §4 command dock: bounded flex column — the transcript gets the
          scroll surface (flex:1, min-height:0); routing/execution/composer
          stay fixed-height rows below it instead of eating scroll space.
          Transparent wrapper for non-command (conversation panel) use. */}
      <div style={transcriptVariant === 'command' ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : undefined}>
      <div className={styles.chatScrollFrame} data-testid="jarvis-chat-scroll-frame">
        <div
          ref={chatScrollRef}
          onScroll={handleTranscriptScroll}
          className={styles.chatContainer}
          data-testid="jarvis-chat-scroll"
          // Inline scroll contract (§4): the transcript scrolls here even if
          // the stylesheet fails to load — the bounded dock provides height.
          // Jarvis-layout fix: flex-fill (no hard height:100%) so the scroll
          // surface exactly matches the bounded frame and can never extend
          // past it into the composer below.
          style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}
        >
        {transcriptVariant === 'command' && visibleMessages.map((msg) => {
          // ── Command transcript: labeled lines, no bubbles ──
          const label = (() => {
            if (msg.role === 'user') return 'YOU';
            const via = (msg.routedAgent || '').toLowerCase();
            if (via === 'hermes' || via === 'agent-hermes') return 'HERMES';
            if (via === 'codex' || via === 'agent-codex') return 'CODEX';
            if (via === 'reviewer' || via === 'evaluator') return 'REVIEWER';
            if (msg.role === 'agent') return 'JARVIS';
            if (msg.messageType === 'approval_request' || msg.messageType === 'plan') return 'REVIEWER';
            return 'SYSTEM';
          })();
          const color = ({ YOU: '#7dd3fc', JARVIS: '#e2e8f0', HERMES: '#fb923c', CODEX: '#4ade80', REVIEWER: '#c084fc', SYSTEM: '#64748b' } as Record<string, string>)[label] || '#94a3b8';
          return (
            <div key={msg.id} data-testid="jarvis-command-line" style={{ display: 'flex', gap: 10, padding: '5px 2px', borderBottom: '1px solid rgba(30,41,59,0.4)', fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontSize: 12, lineHeight: 1.55 }}>
              <span style={{ color, flexShrink: 0, width: 78, letterSpacing: 1, fontWeight: 700 }}>{label}</span>
              <span style={{ color: msg.messageType === 'error' ? '#fca5a5' : '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}>
                {renderMessageContent(msg.content)}
              </span>
            </div>
          );
        })}
        {transcriptVariant !== 'command' && visibleMessages.map(msg => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';
          const isError = msg.messageType === 'error';

          return (
            <div key={msg.id} className={`${styles.messageRow} ${isUser ? styles.user : isSystem ? styles.system : styles.agent}`}>
              {!isSystem && (
                <div className={`${styles.messageAvatar} ${isUser ? styles.user : styles.agent}`}>
                  {isUser ? <User size={16} /> : <Cpu size={16} />}
                </div>
              )}

              <div className={styles.messageContent} style={isError ? { borderColor: 'var(--color-error)' } : {}}>
                {!isSystem && (
                  <div className={styles.messageMeta}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {isUser ? 'You' : 'Jarvis'}
                        {msg.routedAgent && msg.routedAgent !== 'jarvis' && ` (via ${msg.routedAgent})`}
                      </span>
                      {!isUser && <ProviderBadge message={msg} onClick={() => setDetailsMessage(msg)} />}
                    </div>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}

                {isSystem && msg.messageType === 'routing_event' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)' }}>
                    <Server size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && isError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-error)' }}>
                    <AlertCircle size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && msg.messageType === 'system_status' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-jarvis)' }}>
                    <Cpu size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && msg.messageType === 'plan' && (
                  <div data-testid="jarvis-operational-plan" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && msg.messageType === 'approval_request' && (
                  <div data-testid="jarvis-approval-card" style={{ display: 'grid', gap: 10, color: 'var(--text-primary)' }}>
                    <div style={{ color: 'var(--color-warning)', fontWeight: 700 }}>Approval Required</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{renderMessageContent(msg.content)}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" disabled title="Approval is handled by the generated execution card">Approve</button>
                      <button type="button" disabled title="Approval is handled by the generated execution card">Reject</button>
                    </div>
                  </div>
                )}

                {isSystem && msg.messageType === 'team_preview' && msg.metadata?.teamSheet && (
                  <JarvisTeamPreviewCard
                    conversationId={conversationId || ''}
                    teamId={msg.metadata.teamId}
                    teamSheet={msg.metadata.teamSheet}
                  />
                )}

                {isSystem && msg.messageType === 'team_execution' && msg.runId && msg.id === latestTeamExecutionMessageId && (
                  <div data-testid="jarvis-team-execution">
                    <JarvisTeamExecutionCard
                      runId={msg.runId}
                      teamId={msg.metadata?.teamId}
                    />
                  </div>
                )}

                {isSystem && !['routing_event', 'error', 'system_status', 'plan', 'approval_request', 'team_preview', 'team_execution'].includes(msg.messageType || '') && (
                  <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {!isSystem && (
                  <div style={{ color: isError ? 'var(--color-error)' : 'inherit' }}>
                    {renderMessageContent(msg.content)}
                  </div>
                )}
                
                {!isUser && msg.gateway && (
                  <div className="mt-2 flex flex-col gap-1">
                    <GatewayNotice message={msg} />
                    <GatewayEventTimeline events={msg.gateway.events || []} />
                    {(msg.gateway.status === 'failed' || msg.gateway.status === 'interrupted') && (
                      <GatewayRetryControls 
                        isProcessing={isProcessing} 
                        onRetry={(provider) => handleSendMessage(msg.content, 'typed')} 
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {activeGoalId && (
          <div className={`${styles.messageRow} ${styles.system}`}>
            <div className={styles.messageContent} style={{ background: 'transparent', border: 'none', width: '100%', padding: 0 }}>
              <JarvisGoalCard goalId={activeGoalId} />
            </div>
          </div>
        )}

        {sendError && !sendErrorHiddenByMessage && (
          <div data-testid="jarvis-send-error" className={`${styles.messageRow} ${styles.system}`}>
            <div className={styles.messageContent} style={{ borderColor: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-error)' }}>
              <AlertCircle size={14} />
              {sendError.message}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
        </div>
        {showJumpToLatest && (
          <button
            data-testid="jarvis-jump-to-latest"
            className={styles.jumpToLatest}
            onClick={jumpToLatest}
          >
            ↓ JUMP TO LATEST
          </button>
        )}
      </div>
      </div>

      {/* Routing override + ExecutionBar stay with the transcript command
          flow; only the composer moves out when hideComposer is set (§8) —
          the page hosts it sticky at the bottom of the center column. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' }}>
        <RoutingOverrideControl value={routingOverride} onChange={setRoutingOverride} />
      </div>
      <ExecutionBar />

      {!hideComposer && (
      <JarvisComposer
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
        onCancelResponse={cancelResponse}
        composerText={composerText}
        onComposerTextChange={onComposerTextChange}
        onMicStateChange={onMicStateChange}
        hideMic={hideComposerMic}
        disabledReason={offlineGateReason}
      />
      )}
      
      {detailsMessage && (
        <ProviderDetailsPanel 
          message={detailsMessage} 
          onClose={() => setDetailsMessage(null)} 
        />
      )}
    </>
  );
});
JarvisChat.displayName = 'JarvisChat';
