import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import DrawerShell from './DrawerShell';
import { apiFetch, apiUrl } from '../../api/client';
import {
  Terminal, Send, Loader2, Mic, MicOff, Trash2,
  Volume2, ChevronDown, Brain, Wrench, FileText,
  CheckCircle2, AlertCircle, Clock, Zap
} from 'lucide-react';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  status?: 'pending' | 'streaming' | 'done' | 'error';
  provider?: string;
  model?: string;
  toolCalls?: number;
}

const HERMES_MODELS = [
  { id: 'qwythos-9b',   label: 'Qwythos 9B',   color: '#d4a373', icon: '⬡' },
  { id: 'qwable-coder', label: 'Qwable Coder', color: '#60a5fa', icon: '◈' },
  { id: 'fusion',       label: 'Fusion',        color: '#a78bfa', icon: '✦' },
  { id: 'fugu-ultra',   label: 'Fugu Ultra',    color: '#f97316', icon: '◉' },
];

const QUICK_CMDS = [
  'List all active agents',
  'Show system status',
  'What pipelines are running?',
  'Summarize recent runs',
  'Check memory scopes',
];

const HermesDrawer: React.FC = () => {
  const { runs, agents, refresh } = useData();
  const drawer = useDrawer();

  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [micState, setMicState] = useState<'idle'|'listening'|'processing'|'error'>('idle');
  const [micError, setMicError] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState(HERMES_MODELS[0]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [lastStatus, setLastStatus] = useState<{ ok: boolean; detail: string } | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety timeout
  useEffect(() => {
    if (isProcessing) {
      processingTimeoutRef.current = setTimeout(() => setIsProcessing(false), 90000);
    }
    return () => {
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
    };
  }, [isProcessing]);

  // Auto-scroll
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addEntry = (entry: TranscriptEntry) => setTranscript(prev => [...prev, entry]);

  const updateLastAssistant = (patch: Partial<TranscriptEntry>) => {
    setTranscript(prev => {
      const next = [...prev];
      const idx = next.map(e => e.role).lastIndexOf('assistant');
      if (idx !== -1) next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const speakText = async (text: string) => {
    try {
      const res = await apiFetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId: 'agent-hermes' }),
      });
      if (res.ok) {
        const { audioData } = await res.json();
        if (audioData) {
          if (!audioRef.current) audioRef.current = new Audio();
          audioRef.current.src = `data:audio/mp3;base64,${audioData}`;
          audioRef.current.play().catch(() => {});
        }
      }
    } catch {}
  };

  const sendToAgent = useCallback(async (text: string) => {
    setIsProcessing(true);
    setLastStatus(null);

    addEntry({
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      status: 'done',
    });
    setInput('');

    addEntry({
      id: `ast-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'pending',
    });

    try {
      const res = await apiFetch('/api/voice/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId: 'agent-hermes', model: selectedModel.id }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = errBody.details || errBody.error || `HTTP ${res.status}`;
        setLastStatus({ ok: false, detail });
        updateLastAssistant({ content: `⚠️ ${detail}`, status: 'error' });
        return;
      }

      const data = await res.json();
      const responseText = data.text || 'No response generated.';

      updateLastAssistant({
        content: responseText,
        status: 'done',
        provider: data.provider,
        model: data.model,
        toolCalls: data.toolCalls,
      });

      setLastStatus({ ok: true, detail: `${data.provider || 'OK'} · ${data.model || ''}` });
      speakText(responseText);
      refresh();
    } catch (err: any) {
      const detail = err.message || 'Network error';
      setLastStatus({ ok: false, detail });
      updateLastAssistant({ content: `⚠️ ${detail}`, status: 'error' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [refresh, selectedModel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isProcessing) return;
    sendToAgent(text);
  };

  const handleMic = async () => {
    if (micState === 'listening') { mediaRecorderRef.current?.stop(); return; }
    try {
      setMicError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicState('listening');
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setMicState('processing');
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const transRes = await apiFetch('/api/voice/transcribe', { method: 'POST', body: fd });
          if (transRes.ok) {
            const { text } = await transRes.json();
            if (text?.trim()) {
              setMicState('idle');
              sendToAgent(text.trim());
            }
          } else {
            const errText = await transRes.text();
            setMicError(`Recognition failed: ${errText}`);
            setMicState('error');
            setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
          }
        } catch (err: any) {
          setMicError(`Voice error: ${err.message}`);
          setMicState('error');
          setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
        }
      };
      recorder.start();
      setTimeout(() => { if (mediaRecorderRef.current?.state === 'recording') recorder.stop(); }, 8000);
    } catch (err: any) {
      setMicError(`Mic access denied: ${err.message}`);
      setMicState('error');
      setTimeout(() => { setMicState('idle'); setMicError(''); }, 4000);
    }
  };

  // Recent runs for context panel
  const recentRuns = runs.slice(0, 5);
  const activeAgents = agents.filter(a => a.status === 'active').slice(0, 6);

  return (
    <DrawerShell
      title="Hermes"
      subtitle="Agentic OS assistant"
      icon={<Terminal size={18} color="var(--color-hermes)" />}
      accentColor="var(--color-hermes)"
      onClose={() => drawer.close()}
      isPinned={drawer.isPinned}
      onPin={() => (drawer.isPinned ? drawer.unpin() : drawer.pin())}
    >
      <audio ref={audioRef} style={{ display: 'none' }} />

      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top: Provider + Status bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        }}>
          {/* Status dot */}
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: isProcessing ? 'var(--color-hermes)' : micState === 'listening' ? '#ef4444' : micState === 'error' ? '#ef4444' : '#22c55e',
            boxShadow: isProcessing ? '0 0 8px var(--color-hermes)' : 'none',
            animation: isProcessing ? 'pulse 1.5s infinite' : 'none',
          }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, flex: 1, color: 'var(--text-secondary)' }}>
            {isProcessing ? 'Thinking...' : micState === 'listening' ? 'Listening...' : micState === 'processing' ? 'Transcribing...' : micState === 'error' ? micError : 'Idle'}
          </span>

          {/* Model selector (Hermes One) */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelMenu(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 8px', borderRadius: 6, fontSize: '0.7rem',
                background: 'var(--bg-elevated)', border: `1px solid ${selectedModel.color}44`,
                color: selectedModel.color, cursor: 'pointer', fontWeight: 700,
              }}
            >
              <span style={{ fontSize: '0.75rem' }}>{selectedModel.icon}</span>
              {selectedModel.label}
              <ChevronDown size={9} />
            </button>
            {showModelMenu && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 9999,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, overflow: 'hidden', minWidth: 160,
                boxShadow: 'var(--shadow-xl)',
              }}>
                {HERMES_MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModel(m); setShowModelMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 12px', background: 'none',
                      border: 'none', cursor: 'pointer', fontSize: '0.75rem',
                      color: m.id === selectedModel.id ? m.color : 'var(--text-secondary)',
                      fontWeight: m.id === selectedModel.id ? 700 : 400,
                      borderLeft: m.id === selectedModel.id ? `3px solid ${m.color}` : '3px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: '0.8rem' }}>{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear button */}
          {transcript.length > 0 && (
            <button
              onClick={() => setTranscript([])}
              style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 3 }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* ── Main body: two-column layout ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Left: Transcript */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>
            <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
              {transcript.length === 0 ? (
                <div style={{ paddingTop: 20 }}>
                  <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem', marginBottom: 16 }}>
                    <Brain size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div style={{ fontWeight: 600 }}>Hermes is ready</div>
                    <div style={{ fontSize: '0.72rem', marginTop: 2 }}>Type a command or use the mic.</div>
                  </div>
                  {/* Quick commands */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {QUICK_CMDS.map(cmd => (
                      <button
                        key={cmd}
                        onClick={() => sendToAgent(cmd)}
                        disabled={isProcessing}
                        style={{
                          textAlign: 'left', padding: '6px 10px', borderRadius: 6,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)', fontSize: '0.73rem', cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-hermes)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {transcript.map(entry => (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: entry.role === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div style={{
                        maxWidth: '92%',
                        padding: '8px 12px',
                        borderRadius: entry.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                        fontSize: '0.82rem', lineHeight: 1.55, wordBreak: 'break-word',
                        background: entry.role === 'user'
                          ? 'rgba(212,163,115,0.18)'
                          : entry.status === 'error'
                          ? 'rgba(239,68,68,0.1)'
                          : 'var(--bg-elevated)',
                        border: entry.status === 'error'
                          ? '1px solid rgba(239,68,68,0.3)'
                          : '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}>
                        {entry.role === 'user' ? entry.content : (
                          entry.status === 'pending' ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
                              <Loader2 size={12} className="spin" /> Thinking...
                            </span>
                          ) : entry.content
                        )}
                      </div>
                      {/* Meta line for assistant responses */}
                      {entry.role === 'assistant' && entry.status === 'done' && entry.provider && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>
                          <CheckCircle2 size={8} color="#22c55e" />
                          {entry.provider} · {entry.model}
                          {entry.toolCalls !== undefined && entry.toolCalls > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              · <Wrench size={8} /> {entry.toolCalls} tool call{entry.toolCalls !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}
            </div>

            {/* Input bar */}
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={handleMic}
                  disabled={isProcessing || micState === 'processing'}
                  title={micState === 'listening' ? 'Stop recording' : 'Start voice input'}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: micState === 'listening' ? 'rgba(239,68,68,0.2)' : 'var(--bg-elevated)',
                    border: `1px solid ${micState === 'listening' ? '#ef4444' : micState === 'error' ? '#ef4444' : 'var(--border-subtle)'}`,
                    color: micState === 'listening' ? '#ef4444' : micState === 'error' ? '#ef4444' : 'var(--text-tertiary)',
                    cursor: (isProcessing || micState === 'processing') ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {micState === 'listening' ? <Mic size={13} /> : micState === 'processing' ? <Loader2 size={13} className="spin" /> : <MicOff size={13} />}
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={micState === 'error' ? '' : input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                  placeholder={
                    micState === 'listening' ? 'Listening...' :
                    micState === 'processing' ? 'Transcribing audio...' :
                    micState === 'error' ? micError :
                    "Give Hermes a command..."
                  }
                  disabled={isProcessing || micState === 'listening' || micState === 'processing'}
                  style={{
                    flex: 1, height: 32, padding: '0 12px', borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    fontSize: '0.8rem', outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isProcessing}
                  title="Send"
                  style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: input.trim() && !isProcessing ? 'var(--color-hermes)' : 'var(--bg-elevated)',
                    border: 'none',
                    color: input.trim() && !isProcessing ? '#000' : 'var(--text-tertiary)',
                    cursor: input.trim() && !isProcessing ? 'pointer' : 'not-allowed',
                    opacity: input.trim() && !isProcessing ? 1 : 0.5,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {isProcessing ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                </button>
              </form>
            </div>
          </div>

          {/* Right: Context Panel */}
          <div style={{
            width: 160, flexShrink: 0, overflowY: 'auto',
            padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Active Agents */}
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Active Agents
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeAgents.length === 0 ? (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>None online</span>
                ) : activeAgents.map(agent => (
                  <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: agent.color || '#888', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Runs */}
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Recent Runs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentRuns.length === 0 ? (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>No runs yet</span>
                ) : recentRuns.map(run => (
                  <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    {run.status === 'completed' && <CheckCircle2 size={9} color="#22c55e" />}
                    {run.status === 'failed' && <AlertCircle size={9} color="#ef4444" />}
                    {run.status === 'running' && <Loader2 size={9} className="spin" />}
                    {run.status === 'queued' && <Clock size={9} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {run.agentId?.replace('agent-', '')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Memory Scopes */}
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Memory
              </div>
              {['Global Context', 'Hermes Agent'].map(scope => (
                <div key={scope} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: 3 }}>
                  <FileText size={9} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scope}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer status line ── */}
        <div style={{
          padding: '5px 14px', borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.6rem', color: 'var(--text-tertiary)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Volume2 size={8} /> Deepgram Aura-Orion
          </span>
          {lastStatus ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: lastStatus.ok ? '#22c55e' : '#ef4444' }}>
              {lastStatus.ok ? <CheckCircle2 size={8} /> : <AlertCircle size={8} />}
              {lastStatus.detail}
            </span>
          ) : (
            <span>No response yet</span>
          )}
        </div>
      </div>
    </DrawerShell>
  );
};

export default HermesDrawer;
