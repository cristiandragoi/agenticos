// @ts-nocheck
import { useData } from '../../store/dataStore';
import React, { useState, useRef, useEffect } from 'react';

import { Send, Paperclip, ChevronUp, ChevronDown, Zap, Mic, MicOff } from 'lucide-react';
import { useChat, useDrawer } from '../../store/appStore';
import { useChatManager } from '../../hooks/useChatManager';
import { useLocation } from 'react-router-dom';
import { appendLog, runStage, getPipelineState } from '../../command/jarvisPipeline';
import { useBackendLifecycle } from '../../diagnostics/useBackendLifecycle';
import { apiFetch, apiUrl } from '../../api/client';

const UniversalChatDock: React.FC = () => {
  const location = useLocation();
  // Never render the global dock on Jarvis dashboard
  if (location.pathname.startsWith('/jarvis')) return null;

  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;

  const chat = useChat();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New local state for direct agent calls over OmniRoute
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentReply, setAgentReply] = useState('');

  const { sendMessage, isTyping } = useChatManager();

  const targetAgent = mockAgents.find(a => a.id === chat.targetAgentId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages.length, chat.messages[chat.messages.length - 1]?.content]);

  const [micState, setMicState] = useState<'idle'|'listening'|'processing'|'error'>('idle');
  const [micError, setMicError] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const drawer = useDrawer();

  // Backend lifecycle gate (backend lifecycle milestone): the dock never
  // pretends to process requests while the backend is definitively down.
  // The gate activates on the authoritative lifecycle source (Electron IPC
  // in the desktop app); browser dev mode relies on the AppShell screens.
  const backendLifecycle = useBackendLifecycle();
  const backendDown =
    backendLifecycle.source === 'electron' &&
    (backendLifecycle.status === 'offline' || backendLifecycle.status === 'failed');

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping || agentLoading) return;
    if (backendDown) return; // gated — Jarvis/chat must not fake processing
    const target = chat.targetAgentId || 'auto';
    const text = inputValue.trim();
    setInputValue('');

    if (target === 'agent-jarvis' || target === 'agent-hermes' || target === 'auto') {
      // Use existing complex orchestration pipeline
      sendMessage(text, target);
      if (target === 'agent-jarvis') drawer.open('jarvis', 'jarvis');
      else if (target === 'agent-hermes') drawer.open('hermes', 'hermes');
    } else {
      // Simple direct routing over OmniRoute for coding agents
      const selectedAgent = mockAgents.find(a => a.id === target);
      setAgentLoading(true);
      setAgentReply('');
      try {
        const res = await apiFetch('/api/chat/agents/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: selectedAgent?.name || target, message: text }),
        });
        const data = await res.json();
        setAgentReply(data.reply || data.error || 'No response from model');
      } catch (err: any) {
        setAgentReply(`Error: ${err.message}`);
      } finally {
        setAgentLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMicClick = async () => {
    if (micState === 'listening') {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      return;
    }

    try {
      setMicError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicState('listening');
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Silence detection via Web Audio API
      let silentSince: number | null = null;
      const SILENCE_THRESHOLD = 0.015;
      const SILENCE_TIMEOUT_MS = 3500;
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const checkSilence = () => {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms < SILENCE_THRESHOLD) {
            if (!silentSince) silentSince = Date.now();
            else if (Date.now() - silentSince > SILENCE_TIMEOUT_MS) {
              if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
                ctx.close().catch(() => {});
              }
              return;
            }
          } else {
            silentSince = null;
          }
          requestAnimationFrame(checkSilence);
        };
        requestAnimationFrame(checkSilence);
      } catch {
        // Fallback: hard timeout if AudioContext unavailable
        setTimeout(() => {
          if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
        }, 8000);
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setMicState('processing');
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const fd = new FormData();
          fd.append('audio', audioBlob, 'audio.webm');
          const res = await apiFetch('/api/voice/transcribe', {
            method: 'POST',
            body: fd
          });
          
          if (!res.ok) {
            const errText = await res.text();
            console.error('Dock STT Error:', errText);
            setMicError(`Voice recognition failed: ${errText}`);
            setMicState('error');
            setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
            if (chat.targetAgentId === 'agent-jarvis') {
              appendLog({ stageId: 'input', status: 'failed', commandText: 'Mic Error', summary: errText });
            }
            return;
          }
          
          const { text } = await res.json();
          if (text && text.trim()) {
            setInputValue(text.trim());
            setMicState('idle');
            const target = chat.targetAgentId || 'auto';
            
            if (target === 'agent-jarvis') {
              appendLog({ stageId: 'input', status: 'completed', commandText: text.trim(), summary: 'Voice transcribed successfully.' });
            }
            
            setTimeout(async () => {
              if (target === 'agent-jarvis') {
                drawer.open('jarvis', 'jarvis');
                setInputValue('');
                // Actually trigger the Jarvis pipeline end-to-end
                const result = await runStage('input', text.trim(), { viaHermes: true });
                if (result.ok && result.summary) {
                  await runStage('jarvis_voice_reply', result.summary, { isTTS: true });
                }
              } else {
                sendMessage(text.trim(), target);
                setInputValue('');
                if (target === 'agent-hermes') {
                  drawer.open('hermes', 'hermes');
                }
              }
            }, 800);
          }
        } catch (err: any) {
          console.error('Dock Voice error:', err);
          setMicError(`Voice recognition failed: ${err.message}`);
          setMicState('error');
          setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
          if (chat.targetAgentId === 'agent-jarvis') {
            appendLog({ stageId: 'input', status: 'failed', commandText: 'Network Error', summary: err.message });
          }
        }
      };
      mediaRecorder.start();
    } catch (err: any) {
      console.warn("Mic access denied", err);
      setMicError(`Mic access denied: ${err.message}`);
      setMicState('error');
      setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
    }
  };

  return (
    <div className={`chat-dock glass-panel ${chat.isExpanded ? 'expanded' : ''}`}>
      {/* Context Bar */}
      <div className="chat-dock__context-bar">
        <div className="flex-row gap-2">
          {/* Agent Target Selector */}
          <select
            value={chat.targetAgentId || ''}
            onChange={(e) => chat.setTarget(e.target.value || null)}
            disabled={location.pathname.startsWith('/hermes') || location.pathname.startsWith('/jarvis') || location.pathname.startsWith('/codex')}
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-primary)',
              padding: '2px 6px',
              fontSize: '0.6875rem',
              fontFamily: 'inherit',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">Auto-route</option>
            {mockAgents.filter(a => a.status === 'active').map(a => (
              <option key={a.id} value={a.id}>{a.name}{a.id === 'agent-video' ? ' 🎬' : ''}</option>
            ))}
          </select>


        </div>

        <button
          className="quick-action-btn"
          onClick={chat.toggleExpanded}
          title={chat.isExpanded ? 'Collapse' : 'Expand'}
        >
          {chat.isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Message Thread (visible when expanded) */}
      {chat.isExpanded && (
        <div className="chat-dock__messages">
          {chat.messages.filter(msg => msg.role === 'system' || msg.agentId === chat.targetAgentId || (!msg.agentId && !chat.targetAgentId)).map(msg => {
            const msgAgent = msg.agentId ? mockAgents.find(a => a.id === msg.agentId) : null;
            return (
              <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
                {msg.role === 'agent' && msgAgent && (
                  <div
                    style={{
                      width: 24, height: 24, borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-base)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.6875rem', fontWeight: 700,
                      color: msgAgent.color, flexShrink: 0,
                    }}
                  >
                    {msgAgent.avatar}
                  </div>
                )}
                <div className="chat-message__bubble">
                  {msg.content}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Composer */}
      <div className="chat-dock__composer">
        <button className="quick-action-btn" title="Attach file">
          <Paperclip size={15} />
        </button>
        <input
          className="chat-dock__input"
          type="text"
          placeholder={
            backendDown ? 'Backend offline — chat unavailable' :
            micState === 'listening' ? 'Listening...' :
            micState === 'processing' ? 'Transcribing audio...' :
            micState === 'error' ? micError :
            targetAgent
              ? `Message ${targetAgent.name}...`
              : 'Ask anything or request a task...'
          }
          disabled={backendDown || micState === 'listening' || micState === 'processing' || agentLoading}
          value={micState === 'error' ? '' : inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (!chat.isExpanded) chat.toggleExpanded(); }}
        />
        <button
          className="quick-action-btn"
          onClick={handleSend}
          disabled={backendDown}
          title={backendDown ? 'Backend offline' : 'Send'}
          style={{ color: inputValue.trim() && !backendDown ? 'var(--color-hermes)' : undefined }}
        >
          <Send size={15} />
        </button>
        <button
          className="quick-action-btn"
          onClick={handleMicClick}
          disabled={micState === 'processing'}
          title={micState === 'listening' ? "Stop listening" : "Start Voice Transcription"}
          style={{ color: micState === 'listening' ? '#ef4444' : micState === 'error' ? '#ef4444' : undefined, position: 'relative' }}
        >
          {micState === 'listening' ? (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="pulse-anim" style={{ position: 'absolute', width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)' }} />
              <MicOff size={15} style={{ position: 'relative', zIndex: 1 }} />
            </div>
          ) : micState === 'processing' ? (
            <div className="spin"><Zap size={15} /></div>
          ) : (
            <Mic size={15} />
          )}
        </button>
      </div>

      {/* Direct Agent Reply block for coding agents */}
      {(agentLoading || agentReply) && (
        <div style={{ padding: '12px 16px', background: '#0a0e17', borderTop: '1px solid var(--border-subtle)' }}>
          {agentLoading ? (
            <div style={{ color: '#64748b', fontSize: '12px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={12} className="spin" /> Thinking...
            </div>
          ) : (
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word',
              color: '#e2e8f0', fontSize: '13px', fontFamily: 'var(--font-mono)',
              maxHeight: 200, overflowY: 'auto'
            }}>
              {agentReply}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default UniversalChatDock;



