// @ts-nocheck
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Loader2,
  Volume2,
  History,
  AlertTriangle,
  Database,
  Send,
  X,
  Bookmark,
  Trash2,
  Copy,
} from 'lucide-react';
import { useJarvis, useChat, useDrawer } from '../../store/appStore';
import { useData } from '../../store/dataStore';
import DrawerShell from './DrawerShell';
import ThinkingOrb from '../ui/ThinkingOrb';
import { useVoiceIO } from '../../hooks/useVoiceIO';
import { apiFetch, apiUrl } from '../../api/client';

export interface AgentResponseReadyDetail {
  messageId: string;
  agentId: string;
  conversationId?: string | null;
  text: string;
}

/* ─── Persistence Keys ─── */
const STORAGE_KEY = 'agenticos:jarvis:transcript';
const SAVED_KEY = 'agenticos:jarvis:saved';

/* ─── Helpers ─── */
function loadTranscript(): JarvisTranscriptEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTranscript(entries: JarvisTranscriptEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('[Jarvis] Failed to save transcript:', e);
  }
}

function loadSaved(): JarvisTranscriptEntry[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function toggleSaved(entry: JarvisTranscriptEntry): boolean {
  const saved = loadSaved();
  const idx = saved.findIndex((s) => s.id === entry.id);
  if (idx >= 0) {
    saved.splice(idx, 1);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    return false; // was removed
  }
  saved.unshift(entry);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  return true; // was added
}

import { useChatManager } from '../../hooks/useChatManager';
import type { ChatMessage } from '../../types';
import JarvisControlBoard from '../jarvis/JarvisControlBoard';
import { JARVIS_ORB_EVENTS } from '../jarvis/jarvisOrbState';

/* ─── Component ─── */
const JarvisDrawer: React.FC = () => {
  const jarvis = useJarvis();
  const chat = useChat();
  const { sendMessage: storeSendMessage } = useChat();
  const { sendMessage, isTyping } = useChatManager();
  const { agents, refresh: refreshData } = useData();
  const drawer = useDrawer();

  const [textInput, setTextInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [jarvisMode, setJarvisMode] = useState<'voice'|'board'>('voice');
  const [toast, setToast] = useState<string | null>(null);

  // ── Real-time conversation mode (V1) ──
  // Manual mode stays the default: record → edit transcript → Send.
  // Conversation mode: VAD turn loop auto-submits, Jarvis executes and
  // speaks, listening resumes after playback. All mutable flags live in
  // refs so event handlers / rAF loops never act on stale render state.
  const [conversationMode, setConversationMode] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(true);
  const conversationModeRef = useRef(false);
  const micEnabledRef = useRef(true);
  const voiceOutEnabledRef = useRef(true);
  const voiceRef = useRef<any>(null); // assigned right after useVoiceIO()
  const convProcessingRef = useRef(false);   // one in-flight conversation turn
  const convSubmitSeqRef = useRef(0);        // staleness guard for async turns
  const convExecAbortRef = useRef<AbortController | null>(null);

  // Collision-safe local transcript ID generator. Local voice/text entries
  // used `v-usr-${Date.now()}` / `t-msg-${Date.now()}` — two messages created
  // in the same millisecond produced the SAME id, and React rendered them
  // with duplicate keys (live warning: "two children with the same key
  // v-usr-…"). A monotonic session counter guarantees uniqueness even within
  // one millisecond while keeping ids stable across renders (never regenerated
  // on update). Backend messages carry canonical ids where available; this is
  // only for locally-created optimistic entries.
  const transcriptIdSeqRef = useRef(0);
  const nextTranscriptId = useCallback((prefix: string) => {
    transcriptIdSeqRef.current += 1;
    return `${prefix}-${transcriptIdSeqRef.current}-${Date.now()}`;
  }, []);

  /** Execute one Jarvis turn for the conversation pipeline (single
   *  /api/voice/execute POST — the existing verified route). Exactly one
   *  response is spoken per turn; barge-in can abort mid-playback via
   *  stopSpeaking(); visible text is never erased. */
  const executeJarvisTurn = useCallback(async (text: string, source: 'voice' | 'text') => {
    if (convProcessingRef.current) return; // duplicate-submission safeguard
    convProcessingRef.current = true;
    const turnId = ++convSubmitSeqRef.current;
    const controller = new AbortController();
    convExecAbortRef.current = controller;
    jarvis.setStatus('thinking');
    try {
      const res = await apiFetch('/api/voice/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId: 'agent-jarvis', voice: 'aura-helios-en' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`execute HTTP ${res.status}`);
      const data = await res.json();
      const responseText = data.text || 'No response.';
      if (!conversationModeRef.current || turnId !== convSubmitSeqRef.current) return; // mode ended / stale
      jarvis.addTranscript({
        id: `c-jrv-${turnId}-${Date.now()}`,
        role: 'jarvis',
        text: responseText,
        timestamp: new Date().toISOString(),
      });
      refreshData();
      if (voiceOutEnabledRef.current) {
        // 'speaking' state is confirmed by the hook ONLY after real playback
        // start; playback-ended re-arms listening inside the hook. Do NOT
        // force 'idle' here — the hook's real lifecycle events drive the
        // state (speaking → listening) while audio actually plays.
        await voiceRef.current?.speak(responseText);
      } else {
        voiceRef.current?.startListening(); // conversation re-arm, no audio
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[Jarvis] Conversation turn failed:', err);
      if (conversationModeRef.current) {
        // Error recovery: one clear error state, then back to listening —
        // never a duplicate submission.
        jarvis.setStatus('error');
        setTimeout(() => {
          if (conversationModeRef.current && turnId === convSubmitSeqRef.current) {
            jarvis.setStatus('idle');
            voiceRef.current?.startListening();
          }
        }, 1500);
      }
    } finally {
      if (convExecAbortRef.current === controller) convExecAbortRef.current = null;
      if (turnId === convSubmitSeqRef.current) convProcessingRef.current = false;
    }
  }, [jarvis, refreshData]);

  /** Conversation auto-submit: fires exactly once per valid end-of-speech
   *  transcript (the hook deduplicates identical text + per-blob flags). */
  const handleConversationSubmit = useCallback((text: string) => {
    jarvis.addTranscript({
      id: `c-usr-${convSubmitSeqRef.current + 1}-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    });
    executeJarvisTurn(text, 'voice');
  }, [jarvis, executeJarvisTurn]);

  const playedMessageIds = useRef(new Set<string>());
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const jarvisAgent = agents.find((a) => a.id === 'agent-jarvis');
  const sttEngine = 'Groq Whisper';
  const isWired = true;

  // ── useVoiceIO: handles mic, silence detection, STT, TTS ──
  const voice = useVoiceIO({
    agentId: 'agent-jarvis',
    silenceTimeout: 3500,
    onTranscript: async (text) => {
      // Show what was heard in the transcript immediately
      jarvis.addTranscript({
        id: nextTranscriptId('v-usr'),
        role: 'user',
        text,
        timestamp: new Date().toISOString(),
      });
      // Execute via voice pipeline (single POST, no SSE chain)
      jarvis.setStatus('thinking');
      try {
        const res = await apiFetch('/api/voice/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, agentId: 'agent-jarvis', voice: 'aura-helios-en' }),
        });
        if (res.ok) {
          const data = await res.json();
          const responseText = data.text || 'No response.';
          jarvis.setStatus('speaking');
          jarvis.addTranscript({
            id: nextTranscriptId('v-jrv'),
            role: 'jarvis',
            text: responseText,
            timestamp: new Date().toISOString(),
          });
          voice.speak(responseText).then(() => {
            // Confirm playback success in Activity Log (conversations)
            apiFetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: 'Jarvis Voice Playback', message: `Playback success: "${responseText.slice(0, 60)}"`, source: 'jarvis' })
            }).catch(() => {});
            jarvis.setStatus('idle');
          }).catch((err) => {
            console.error('[Jarvis] Playback failed:', err);
            jarvis.setStatus('error');
            apiFetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: 'Jarvis Voice Playback Failed', message: `Playback failed: ${err.message}`, source: 'jarvis' })
            }).catch(() => {});
          });
        } else {
          jarvis.setStatus('error');
          setTimeout(() => jarvis.setStatus('idle'), 2000);
        }
      } catch (err) {
        console.error('[Jarvis] Execute error:', err);
        jarvis.setStatus('error');
        setTimeout(() => jarvis.setStatus('idle'), 2000);
      }
      refreshData();
    },
    onResponse: (text) => {
      jarvis.addTranscript({
        id: nextTranscriptId('v-jrv'),
        role: 'jarvis',
        text,
        timestamp: new Date().toISOString(),
      });
    },
    onStateChange: (s) => {
      jarvis.setStatus(s);
    },
    // ── Conversation mode: auto-submit exactly once per valid end-of-speech
    // transcript. The hook dedupes identical text and flags each blob. ──
    onAutoSubmit: (text) => handleConversationSubmit(text),
    endSpeechSilenceMs: 900, // measured-silence turn end (spec: 700–1200 ms)
  });
  voiceRef.current = voice; // handlers/rAF loops read the latest instance via ref

  // ── Conversation-mode controls ──
  const handleModeToggle = useCallback(async (mode: 'manual' | 'conversation') => {
    if (mode === 'conversation') {
      if (conversationModeRef.current) return;
      if (!micEnabledRef.current) {
        setToast('Enable the microphone first');
        setTimeout(() => setToast(null), 2000);
        return;
      }
      conversationModeRef.current = true;
      setConversationMode(true);
      setShowBoard(false); // conversation happens in the Chat view
      const ok = await voiceRef.current?.startConversation();
      if (!ok) {
        conversationModeRef.current = false;
        setConversationMode(false);
        setToast('Microphone unavailable — check permissions');
        setTimeout(() => setToast(null), 2500);
      }
    } else {
      if (!conversationModeRef.current) return;
      conversationModeRef.current = false;
      setConversationMode(false);
      convSubmitSeqRef.current++; // invalidate any in-flight conversation turn
      convExecAbortRef.current?.abort();
      convProcessingRef.current = false;
      voiceRef.current?.endConversation();
      jarvis.setStatus('idle');
    }
  }, [jarvis]);

  const handleMicToggle = useCallback(() => {
    const next = !micEnabledRef.current;
    micEnabledRef.current = next;
    setMicEnabled(next);
    if (!next && conversationModeRef.current) {
      // Disabling the mic ends conversation mode (no capture without mic).
      handleModeToggle('manual');
    }
  }, [handleModeToggle]);

  const handleVoiceOutToggle = useCallback(() => {
    const next = !voiceOutEnabledRef.current;
    voiceOutEnabledRef.current = next;
    setVoiceOutEnabled(next);
    voiceRef.current?.setVoiceEnabled(next);
  }, []);

  const handleStopSpeaking = useCallback(() => {
    voiceRef.current?.stopSpeaking();
  }, []);

  // ── Persistence: restore on mount, save on every change ──
  useEffect(() => {
    if (jarvis.transcript.length === 0) {
      const saved = loadTranscript();
      if (saved.length > 0) {
        saved.forEach((e) => jarvis.addTranscript(e));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (jarvis.transcript.length > 0) {
      saveTranscript(jarvis.transcript);
    }
  }, [jarvis.transcript]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [jarvis.transcript]);

  // ── Bridge: watch universal chat for agent-jarvis responses → copy into Jarvis transcript ──
  const lastBridgedRef = useRef<string | null>(null);
  const bridgeInProgressRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chat.messages || chat.messages.length === 0) return;
    // Find the latest agent message for Jarvis — handle both completed and streaming
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (msg.role === 'agent' && (msg as any).agentId === 'agent-jarvis' && msg.content) {
        const existingText = msg.content.trim();
        if (!existingText) break; // no content yet, skip

        // If we already have an in-progress bridge, update it by removing + re-adding
        if (bridgeInProgressRef.current === msg.id) {
          // Update: remove old entry, add new one with latest text
          const existing = jarvis.transcript.filter(t => t.id !== msg.id);
          jarvis.clearTranscript();
          existing.forEach(e => jarvis.addTranscript(e));
          jarvis.addTranscript({
            id: msg.id,
            role: 'jarvis',
            text: existingText,
            timestamp: (msg as any).timestamp || new Date().toISOString(),
          });
          break;
        }

        // First time seeing this message — bridge it
        if (lastBridgedRef.current !== msg.id) {
          const alreadyInTranscript = jarvis.transcript.some(t => t.id === msg.id);
          if (!alreadyInTranscript) {
            lastBridgedRef.current = msg.id;
            bridgeInProgressRef.current = msg.id;
            jarvis.addTranscript({
              id: msg.id,
              role: 'jarvis',
              text: existingText,
              timestamp: (msg as any).timestamp || new Date().toISOString(),
            });
          }
        }
        break;
      }
    }
  }, [chat.messages, jarvis]);

  // ── Text send (direct voice/execute) ──
  const handleTextSend = useCallback(async () => {
    const text = textInput.trim();
    if (!text || isSending) return;
    setIsSending(true);

    const userEntry = {
      id: nextTranscriptId('t-msg'),
      role: 'user' as const,
      text,
      timestamp: new Date().toISOString(),
    };
    jarvis.addTranscript(userEntry);
    setTextInput('');

    jarvis.setStatus('thinking');
    try {
      const res = await apiFetch('/api/voice/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId: 'agent-jarvis', voice: 'aura-helios-en' }),
      });
      if (res.ok) {
        const data = await res.json();
        const responseText = data.text || 'No response.';
        jarvis.setStatus('speaking');
        jarvis.addTranscript({
          id: nextTranscriptId('t-jrv'),
          role: 'jarvis',
          text: responseText,
          timestamp: new Date().toISOString(),
        });
        voice.speak(responseText).then(() => {
          // Confirm playback success in Activity Log (conversations)
          apiFetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Jarvis Voice Playback', message: `Playback success: "${responseText.slice(0, 60)}"`, source: 'jarvis' })
          }).catch(() => {});
          jarvis.setStatus('idle');
        }).catch((err) => {
          console.error('[Jarvis] Playback failed:', err);
          jarvis.setStatus('error');
          apiFetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Jarvis Voice Playback Failed', message: `Playback failed: ${err.message}`, source: 'jarvis' })
          }).catch(() => {});
        });
      } else {
        jarvis.setStatus('error');
        setTimeout(() => jarvis.setStatus('idle'), 2000);
      }
    } catch (err) {
      console.error('[Jarvis] Text execute error:', err);
      jarvis.setStatus('error');
      setTimeout(() => jarvis.setStatus('idle'), 2000);
    }
    setIsSending(false);
  }, [textInput, isSending, jarvis, voice]);

  // ── Mic: delegate fully to useVoiceIO ──
  const handleMicClick = () => {
    if (!micEnabledRef.current) return; // microphone disabled via controls
    micAttemptedRef.current = false;  // Allow retry on manual click
    voice.toggleListening();
  };

  // ── Auto-start mic for continuous conversation ──
  // Track whether we've already tried mic to avoid infinite retry loops
  const micAttemptedRef = useRef(false);

  // The `voice` object from useVoiceIO has a NEW identity on every render.
  // It must NOT appear in the effect deps below: the previous version did,
  // so EVERY re-render ran the effect cleanup, which called voice.stopAudio()
  // and aborted the in-flight TTS fetch/playback. That made audible speech on
  // the Mission Control Jarvis surface impossible: speak() started, the next
  // status/transcript re-render fired, cleanup aborted the TTS request, and
  // the AbortError path resolved silently. All voice access goes through the
  // voiceRef (declared once near the top, refreshed every render) so the
  // effect only re-runs on real drawer open/close transitions.

  useEffect(() => {
    const drawerOpenForJarvis = drawer.isOpen && drawer.entityType === 'jarvis';

    if (drawerOpenForJarvis) {
      // Manual-mode convenience: auto-arm the mic once when the drawer opens
      // (existing behaviour — preserved). Honors the microphone toggle.
      if (micEnabledRef.current && voiceRef.current.voiceState === 'idle' && jarvis.status !== 'speaking' && !micAttemptedRef.current) {
        micAttemptedRef.current = true;
        voiceRef.current.startListening();
      }
    } else {
      micAttemptedRef.current = false;
      voiceRef.current.stopListening();
    }

    // Real playback-ended event (dispatched by useVoiceIO only after actual
    // playback finished) → re-arm listening for the interactive voice loop.
    // In conversation mode the hook itself owns the resume (afterPlaybackEnd),
    // so this handler defers to it to avoid double management.
    const handlePlaybackEnded = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.agentId !== 'agent-jarvis') return;
      if (conversationModeRef.current) return; // hook re-arms automatically
      if (drawerOpenForJarvis) {
        micAttemptedRef.current = false;
        voiceRef.current.startListening();
      }
    };

    const handleResponseReady = (e: Event) => {
      const customEvent = e as CustomEvent<AgentResponseReadyDetail>;
      const { agentId, text, messageId, conversationId } = customEvent.detail;
      
      if (!agentId || !text || !messageId) {
        console.warn('[TTSPlayback] Invalid payload', customEvent.detail);
        return;
      }
      
      if (agentId !== 'agent-jarvis') {
        console.log('[TTSPlayback]', { messageId, agentId, conversationId, ownerComponent: 'JarvisDrawer', action: 'wrong-agent' });
        return;
      }

      if (messageId) {
        if (playedMessageIds.current.has(messageId)) {
          console.log('[TTSPlayback]', { messageId, agentId, conversationId, ownerComponent: 'JarvisDrawer', action: 'skip-duplicate' });
          return;
        }
        playedMessageIds.current.add(messageId);
        if (playedMessageIds.current.size > 50) {
          const first = playedMessageIds.current.values().next().value;
          if (first) playedMessageIds.current.delete(first);
        }
      }
      
      console.log('[TTSPlayback]', { messageId, agentId, conversationId, ownerComponent: 'JarvisDrawer', action: 'start' });

      const textToSpeak = text;
      voiceRef.current.speak(textToSpeak).then(() => {
        apiFetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Jarvis Voice Playback', message: `Playback success: "${textToSpeak.slice(0, 60)}"`, source: 'jarvis' })
        }).catch(() => {});
      }).catch((err) => {
        apiFetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Jarvis Voice Playback Failed', message: `Playback failed: ${err.message}`, source: 'jarvis' })
        }).catch(() => {});
      });
    };

    window.addEventListener(JARVIS_ORB_EVENTS.playbackEnded, handlePlaybackEnded as EventListener);
    window.addEventListener('agent-response-ready', handleResponseReady as EventListener);

    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackEnded, handlePlaybackEnded as EventListener);
      window.removeEventListener('agent-response-ready', handleResponseReady as EventListener);
      // Cleanup runs ONLY on a real drawer transition (deps: isOpen/entityType)
      // or on unmount — never on ordinary re-renders, because `voice` is
      // deliberately kept out of the deps (that was the abort bug: every
      // re-render aborted the in-flight TTS request, killing all speech).
      console.log('[TTSPlayback]', { ownerComponent: 'JarvisDrawer', action: 'stop', reason: 'transition-or-unmount' });
      voiceRef.current.stopAudio?.();
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer.isOpen, drawer.entityType]);

  // ── Save / memory toggle ──
  const handleSaveToggle = (entry: JarvisTranscriptEntry) => {
    const wasAdded = toggleSaved(entry);
    setToast(wasAdded ? 'Saved to local memory' : 'Removed from saved');
    setTimeout(() => setToast(null), 2000);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setToast('Copied to clipboard');
    setTimeout(() => setToast(null), 2000);
  };

  const handleClear = () => {
    jarvis.clearTranscript();
    localStorage.removeItem(STORAGE_KEY);
    setToast('Conversation cleared');
    setTimeout(() => setToast(null), 2000);
  };

  const [showBoard, setShowBoard] = useState(true);
  // Saved-entries popover visibility. NOTE: this state was referenced by the
  // Chat view JSX but never declared — a pre-existing ReferenceError that
  // crashed the drawer the moment the Chat tab rendered. Declared here.
  const [showSaved, setShowSaved] = useState(false);
  const savedEntries = loadSaved();
  const queryCount = jarvis.transcript.filter((t) => t.role === 'user').length;

  // ── Status helpers ──
  const isActive =
    jarvis.status !== 'idle' && jarvis.status !== 'error' && jarvis.status !== 'speaking';

  // ── Render ──
  return (
    <DrawerShell
      title="Jarvis"
      subtitle="Chat-first assistant"
      icon={<Volume2 size={18} color="var(--color-hermes)" />}
      accentColor="var(--color-hermes)"
      onClose={() => drawer.close()}
      isPinned={drawer.isPinned}
      onPin={() => (drawer.isPinned ? drawer.unpin() : drawer.pin())}
    >
      {/* ── Mode Toggle ── */}
      <div style={{
        display: 'flex', gap: 0, padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <button onClick={() => setShowBoard(true)} style={{
          flex: 1, padding: '6px 0', border: 'none', cursor: 'pointer', borderRadius: '6px 0 0 6px',
          fontSize: 12, fontWeight: 600,
          background: showBoard ? 'var(--color-hermes)' : 'var(--bg-elevated)',
          color: showBoard ? '#fff' : 'var(--text-tertiary)',
        }}>
          ⚡ Control Board
        </button>
        <button onClick={() => setShowBoard(false)} style={{
          flex: 1, padding: '6px 0', border: 'none', cursor: 'pointer', borderRadius: '0 6px 6px 0',
          fontSize: 12, fontWeight: 600,
          background: !showBoard ? 'var(--color-hermes)' : 'var(--bg-elevated)',
          color: !showBoard ? '#fff' : 'var(--text-tertiary)',
        }}>
          💬 Chat
        </button>
      </div>

      {/* ── Voice Conversation Controls (V1) ──
          Manual: record → edit transcript → Send (unchanged).
          Conversation: continuous VAD turn loop — speak, pause, Jarvis answers
          aloud, listening resumes automatically. */}
      <div
        data-testid="jarvis-conversation-bar"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
          borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
          background: conversationMode ? 'rgba(56, 189, 248, 0.06)' : 'transparent',
        }}
      >
        {/* Mode selector */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
          <button
            data-testid="jarvis-mode-manual"
            onClick={() => handleModeToggle('manual')}
            style={{
              padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: !conversationMode ? 'var(--bg-elevated)' : 'transparent',
              color: !conversationMode ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            Manual
          </button>
          <button
            data-testid="jarvis-mode-conversation"
            onClick={() => handleModeToggle('conversation')}
            style={{
              padding: '4px 10px', border: 'none', borderLeft: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: conversationMode ? 'var(--color-hermes)' : 'transparent',
              color: conversationMode ? '#fff' : 'var(--text-tertiary)',
            }}
          >
            Conversation
          </button>
        </div>

        {/* State indicator (real voiceState only — never faked) */}
        <span
          data-testid="jarvis-conv-state"
          style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {conversationMode ? voice.voiceState : 'manual'}
        </span>

        <div style={{ flex: 1 }} />

        {/* Microphone enable/disable */}
        <button
          data-testid="jarvis-conv-mic-toggle"
          onClick={handleMicToggle}
          title={micEnabled ? 'Disable microphone' : 'Enable microphone'}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)',
            background: micEnabled ? 'var(--bg-elevated)' : 'rgba(239, 68, 68, 0.15)',
            color: micEnabled ? 'var(--text-secondary)' : '#ef4444',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
        </button>

        {/* Voice output enable/disable */}
        <button
          data-testid="jarvis-conv-voiceout-toggle"
          onClick={handleVoiceOutToggle}
          title={voiceOutEnabled ? 'Disable voice output' : 'Enable voice output'}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)',
            background: voiceOutEnabled ? 'var(--bg-elevated)' : 'rgba(239, 68, 68, 0.15)',
            color: voiceOutEnabled ? 'var(--text-secondary)' : '#ef4444',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: voiceOutEnabled ? 1 : 0.7,
          }}
        >
          <Volume2 size={14} />
        </button>

        {/* Stop speaking (visible only while Jarvis is audibly speaking) */}
        {voice.isSpeaking && (
          <button
            data-testid="jarvis-conv-stop-speaking"
            onClick={handleStopSpeaking}
            title="Stop speaking"
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239, 68, 68, 0.4)',
              background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}

        {/* End conversation mode */}
        {conversationMode && (
          <button
            data-testid="jarvis-conv-end"
            onClick={() => handleModeToggle('manual')}
            title="End conversation mode"
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            End
          </button>
        )}
      </div>

      {showBoard ? (
        <JarvisControlBoard />
      ) : (
      <div
        className="flex-col"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* ── Thinking Orb + Status Strip ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <ThinkingOrb status={jarvis.status} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              {jarvis.status === 'idle'
                ? 'Jarvis is idle'
                : jarvis.status === 'listening'
                ? 'Listening...'
                : jarvis.status === 'transcribing'
                ? 'Transcribing...'
                : jarvis.status === 'thinking'
                ? 'Thinking...'
                : jarvis.status === 'speaking'
                ? 'Speaking...'
                : 'Error'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {jarvis.status === 'idle'
                ? 'Ask anything — text or voice'
                : 'Processing your request'}
            </div>
          </div>
        </div>

        {/* ── Status Cards ── */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {/* STT Provider */}
          <div
            style={{
              flex: 1,
              minWidth: 100,
              padding: '6px 10px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>
              STT Provider
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              {isWired ? (
                <Volume2 size={11} color="var(--color-success)" />
              ) : (
                <AlertTriangle size={11} color="var(--color-warning)" />
              )}
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: isWired ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {isWired ? 'READY' : 'MOCKED'}
              </span>
            </div>
          </div>

          {/* Queries Counter */}
          <div
            style={{
              flex: 1,
              minWidth: 100,
              padding: '6px 10px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>
              Recent Commands
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-hermes)', marginTop: 2 }}>
              {queryCount === 0
                ? 'No queries yet'
                : `${queryCount} query${queryCount !== 1 ? 's' : ''} in session`}
            </div>
          </div>

          {/* Saved Pill */}
          {savedEntries.length > 0 && (
            <div
              onClick={() => setShowSaved(!showSaved)}
              style={{
                minWidth: 80,
                padding: '6px 10px',
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${
                  showSaved ? 'var(--color-hermes)' : 'var(--border-subtle)'
                }`,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>
                Saved
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-hermes)', marginTop: 2 }}>
                {savedEntries.length}
              </div>
            </div>
          )}
        </div>

        {/* ── Saved Popover ── */}
        {showSaved && savedEntries.length > 0 && (
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>
              Saved replies
            </div>
            {savedEntries.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  borderRadius: '4px',
                  background: 'var(--bg-elevated)',
                  marginBottom: 4,
                  fontSize: '0.75rem',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.text.slice(0, 60)}
                </span>
                <button
                  onClick={() => handleCopy(s.text)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 2 }}
                  title="Copy"
                >
                  <Copy size={11} />
                </button>
                <button
                  onClick={() => handleSaveToggle(s)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 2 }}
                  title="Remove from saved"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Transcript ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px',
          }}
        >
          {jarvis.transcript.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-tertiary)',
                fontSize: '0.85rem',
                paddingTop: 40,
              }}
            >
              {(jarvis.status === 'listening' || jarvis.status === 'speaking' || jarvis.status === 'thinking' || jarvis.status === 'transcribing') ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                  <style>{`
                    @keyframes jarvis-pulse-listening {
                      0% { transform: scale(0.95); box-shadow: 0 0 10px rgba(212, 163, 115, 0.3); }
                      100% { transform: scale(1.05); box-shadow: 0 0 30px rgba(212, 163, 115, 0.7), 0 0 60px rgba(212, 163, 115, 0.3); }
                    }
                    @keyframes jarvis-pulse-speaking {
                      0% { transform: scale(0.9); box-shadow: 0 0 10px rgba(100, 200, 255, 0.4); }
                      100% { transform: scale(1.15); box-shadow: 0 0 40px rgba(100, 200, 255, 0.8), 0 0 80px rgba(100, 200, 255, 0.4); }
                    }
                  `}</style>
                  <div style={{
                    width: 70,
                    height: 70,
                    borderRadius: '50%',
                    background: jarvis.status === 'speaking' ? 'radial-gradient(circle at 30% 30%, rgba(100, 200, 255, 0.9), rgba(100, 200, 255, 0.3))' : 'radial-gradient(circle at 30% 30%, rgba(212, 163, 115, 0.9), rgba(212, 163, 115, 0.3))',
                    animation: jarvis.status === 'speaking' ? 'jarvis-pulse-speaking 0.4s infinite alternate' : (jarvis.status === 'listening' ? 'jarvis-pulse-listening 1s infinite alternate' : 'jarvis-pulse-listening 2s infinite alternate'),
                    transition: 'all 0.3s ease-in-out'
                  }} />
                </div>
              ) : (
                <Volume2 size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              )}
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Hello, I'm Jarvis</div>
              <div style={{ fontSize: '0.75rem' }}>
                Type a message or tap the mic to start a conversation.
              </div>
            </div>
          ) : (
            <div className="flex-col gap-3" style={{ minHeight: '100%' }}>
              {jarvis.transcript.map((entry) => (
                <div
                  key={entry.id}
                  data-testid="jarvis-drawer-transcript-entry"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: entry.role === 'jarvis' ? 'flex-start' : 'flex-end',
                  }}
                >
                  {entry.role === 'jarvis' && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        color: 'var(--text-tertiary)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        marginBottom: 4,
                      }}
                    >
                      Jarvis
                    </span>
                  )}
                  <div
                    style={{
                      maxWidth: '90%',
                      padding: '8px 12px',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      lineHeight: 1.5,
                      background:
                        entry.role === 'jarvis'
                          ? 'var(--bg-elevated)'
                          : 'rgba(212, 163, 115, 0.2)',
                      color: 'var(--text-primary)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {entry.text}
                  </div>
                  {entry.role === 'jarvis' && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        marginTop: 4,
                        paddingLeft: 4,
                      }}
                    >
                      <button
                        onClick={() => handleSaveToggle(entry)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          padding: 2,
                        }}
                        title="Save reply"
                      >
                        <Bookmark size={11} />
                      </button>
                      <button
                        onClick={() => handleCopy(entry.text)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          padding: 2,
                        }}
                        title="Copy reply"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Orb Visualization at bottom of transcript */}
              {(jarvis.status === 'listening' || jarvis.status === 'speaking' || jarvis.status === 'thinking' || jarvis.status === 'transcribing') && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, marginBottom: 24 }}>
                  <style>{`
                    @keyframes jarvis-pulse-listening {
                      0% { transform: scale(0.95); box-shadow: 0 0 10px rgba(212, 163, 115, 0.3); }
                      100% { transform: scale(1.05); box-shadow: 0 0 30px rgba(212, 163, 115, 0.7), 0 0 60px rgba(212, 163, 115, 0.3); }
                    }
                    @keyframes jarvis-pulse-speaking {
                      0% { transform: scale(0.9); box-shadow: 0 0 10px rgba(100, 200, 255, 0.4); }
                      100% { transform: scale(1.15); box-shadow: 0 0 40px rgba(100, 200, 255, 0.8), 0 0 80px rgba(100, 200, 255, 0.4); }
                    }
                  `}</style>
                  <div style={{
                    width: 70,
                    height: 70,
                    borderRadius: '50%',
                    background: jarvis.status === 'speaking' ? 'radial-gradient(circle at 30% 30%, rgba(100, 200, 255, 0.9), rgba(100, 200, 255, 0.3))' : 'radial-gradient(circle at 30% 30%, rgba(212, 163, 115, 0.9), rgba(212, 163, 115, 0.3))',
                    animation: jarvis.status === 'speaking' ? 'jarvis-pulse-speaking 0.4s infinite alternate' : (jarvis.status === 'listening' ? 'jarvis-pulse-listening 1s infinite alternate' : 'jarvis-pulse-listening 2s infinite alternate'),
                    transition: 'all 0.3s ease-in-out'
                  }} />
                </div>
              )}
              
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>

        {/* ── Toast ── */}
        {toast && (
          <div
            style={{
              position: 'absolute',
              bottom: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '6px 14px',
              background: 'rgba(0,0,0,0.85)',
              borderRadius: '999px',
              fontSize: '0.75rem',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {toast}
          </div>
        )}

        {voice.playbackError && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            borderTop: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fc8181',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}>
            <span><strong>Voice Playback Error:</strong> {voice.playbackError}</span>
          </div>
        )}

        {/* ── Input Area ── */}
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            {/* Mic button */}
            <button
              onClick={handleMicClick}
              disabled={isSending}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background:
                  jarvis.status === 'listening'
                    ? 'rgba(239, 68, 68, 0.2)'
                    : 'var(--bg-elevated)',
                border: `1px solid ${
                  jarvis.status === 'listening'
                    ? '#ef4444'
                    : 'var(--border-subtle)'
                }`,
                color:
                  jarvis.status === 'listening'
                    ? '#ef4444'
                    : 'var(--text-tertiary)',
                cursor: isSending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              title={jarvis.status === 'listening' ? 'Stop listening' : 'Voice input'}
            >
              {jarvis.status === 'listening' ? (
                <Mic size={16} />
              ) : (
                <MicOff size={16} />
              )}
            </button>

            {/* Text input */}
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleTextSend();
                  }
                }}
                placeholder="Ask Jarvis anything..."
                disabled={isSending}
                style={{
                  width: '100%',
                  height: 36,
                  padding: '0 12px',
                  borderRadius: '18px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  outline: 'none',
                }}
                autoFocus
              />
            </div>

            {/* Send button */}
            <button
              onClick={handleTextSend}
              disabled={!textInput.trim() || isSending}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: textInput.trim()
                  ? 'var(--color-hermes)'
                  : 'var(--bg-elevated)',
                border: 'none',
                color: textInput.trim() ? '#000' : 'var(--text-tertiary)',
                cursor:
                  !textInput.trim() || isSending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                opacity: !textInput.trim() || isSending ? 0.5 : 1,
              }}
              title="Send"
            >
              {isSending ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>

          {/* Bottom strip: voice config info + clear */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
              padding: '0 4px',
            }}
          >
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)', fontSize: '0.65rem', textAlign: 'center' }}>
              <div>STT: Groq Whisper Large V3</div>
              <div>LLM: {jarvis.provider || 'OpenRouter (gpt-4o-mini)'}</div>
              <div>TTS: Deepgram Aura Helios (UK Male)</div>
              <div style={{ marginTop: 4, opacity: 0.5 }}>Agentic OS v9.0 • Memory Sync Active</div>
            </div>
            {jarvis.transcript.length > 0 && (
              <button
                onClick={handleClear}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  fontSize: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: 0,
                }}
                title="Clear conversation"
              >
                <Trash2 size={10} />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </DrawerShell>
  );
};

export default JarvisDrawer;

