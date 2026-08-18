// @ts-nocheck
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Terminal, Brain, Layers, Mic, MicOff, Send, X, Zap, Command,
  Radio, ChevronDown, Play, Trash2, User, Bot, MessageSquare,
  Shuffle, Settings, Globe, Code2, Cpu, ArrowRight, Loader2,
  SlidersHorizontal, MonitorPlay, FolderOpen, PanelLeft
} from 'lucide-react';
import { useData } from '../store/dataStore';
import { useChatManager } from '../hooks/useChatManager';
import { useChat } from '../store/appStore';
import { useNavigate } from 'react-router-dom';
import { useKanbanMutations } from '../lib/dataport';
import ReviewQueuePanel from '../components/revenue/ReviewQueuePanel';
import { apiFetch, apiUrl } from '../api/client';

/* ═══════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════ */


interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

interface WorkspaceItem {
  id: string;
  name: string;
  preview?: string;
}

type StudioTab =
  | 'Workflows' | 'Manage' | 'MCPs' | 'Control Room' | 'Goal Mode' | 'Review Queue';

const STUDIO_TABS: StudioTab[] = [
  'Workflows', 'Manage', 'MCPs', 'Control Room', 'Goal Mode', 'Review Queue'
];

const PROFILES = [
  'default', 'julian', 'jarvis', 'local', 'blank-slate', 'north-mini',
  'glm-5.2', 'ollama-glm-5.2', 'game-dev', 'seo-lead', 'grok-build',
  'qwen-3-7', 'kimi-k2-7', 'content-editor', 'content-judge', 'content-keyword',
];

const WORKSPACE_ITEMS: WorkspaceItem[] = [
  { id: '1', name: 'Wormhole – Pythonorg' },
  { id: '2', name: 'Voxel City' },
  { id: '3', name: 'Waves – Animated Ocean' },
  { id: '4', name: 'Voxel – Voxel Art Landscape' },
  { id: '5', name: 'Twilight Vale' },
  { id: '6', name: 'DOOM – Raycaster Maze' },
  { id: '7', name: 'Terrain – Procedural 3D Terr…' },
];

const PANEL_MODELS = [
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5', color: '#d97757', icon: '◉' },
  { id: 'gpt-5.5', label: 'GPT-5.5', color: '#10a37f', icon: '◉' },
  { id: 'synthesizer', label: 'Synthesizer', color: '#a78bfa', icon: '★', chair: true },
];

/* Model picker options for the Chat panel */
const STUDIO_MODELS = [
  { id: 'qwythos-9b',    label: 'Qwythos 9B',   color: '#d4a373' },
  { id: 'qwable-coder',  label: 'Qwable Coder', color: '#60a5fa' },
  { id: 'fusion',        label: 'Fusion',        color: '#a78bfa' },
  { id: 'fugu-ultra',    label: 'Fugu Ultra',    color: '#f97316' },
  { id: 'deepseek',      label: 'DeepSeek',      color: '#34d399' },
  { id: 'qwen-3.5',      label: 'Qwen 3.5',      color: '#38bdf8' },
  { id: 'kimi-k2',       label: 'Kimi K2',       color: '#e879f9' },
];

const STUDIO_AGENTS = [
  { id: 'agent-jarvis-core', label: 'Jarvis Core', color: '#60a5fa' },
  { id: 'agent-forge', label: 'Forge', color: '#f59e0b' },
  { id: 'agent-architect', label: 'Architect', color: '#a78bfa' },
  { id: 'agent-scout', label: 'Scout', color: '#34d399' },
];

const QUICK_PROMPTS = [
  'Design a referral loop for a $59/mo…',
  'Write a tight Python function to find…',
  "What's the strongest counter-argument?",
];

/* ═══════════════════════════════════════════════
   STYLE CONSTANTS
═══════════════════════════════════════════════ */
const S = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #07050f 0%, #0d0820 40%, #060412 100%)',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px 32px 0',
    flexShrink: 0,
  },
  title: {
    fontSize: '1.4rem',
    fontWeight: 800,
    letterSpacing: '-0.04em',
    background: 'linear-gradient(90deg, #d4a373 0%, #f0c9a0 60%, #c084fc 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    margin: 0,
    lineHeight: 1,
  },
  subtitle: {
    fontSize: '0.82rem',
    color: 'rgba(255,255,255,0.4)',
    marginTop: '6px',
    letterSpacing: '0.01em',
  },
  meta: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    alignItems: 'center',
  },
  metaBadge: (color = '#d4a373') => ({
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: '2px 8px',
    borderRadius: '4px',
    border: `1px solid ${color}55`,
    color,
    background: `${color}11`,
  }),
  headerBtns: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  topBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '0.76rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    backdropFilter: 'blur(8px)',
  },
  // Tab bar
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: '8px 32px 0',
    flexShrink: 0,
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
    opacity: 0.85,
  },
  tab: (active: boolean) => ({
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '0.75rem',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    border: active ? '1px solid rgba(164,105,220,0.5)' : '1px solid rgba(255,255,255,0.06)',
    background: active
      ? 'linear-gradient(135deg, rgba(120,60,200,0.4) 0%, rgba(90,40,180,0.3) 100%)'
      : 'rgba(255,255,255,0.03)',
    color: active ? '#d4a3ff' : 'rgba(255,255,255,0.45)',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  }),
  // Main content area
  content: {
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  // Glass card
  card: (extra?: React.CSSProperties) => ({
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    backdropFilter: 'blur(16px)',
    ...extra,
  }),
  // Section label
  sectionLabel: {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,0.25)',
    marginBottom: '10px',
  },
};

/* ═══════════════════════════════════════════════
   AGENTAVATAR
═══════════════════════════════════════════════ */
function AgentAvatar({ size = 40, active = false }: { size?: number; active?: boolean }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 4,
      background: 'linear-gradient(135deg, #d4a37355 0%, #c084fc44 100%)',
      border: `1.5px solid ${active ? '#d4a373' : 'rgba(212,163,115,0.3)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: active ? '0 0 20px rgba(212,163,115,0.25)' : 'none',
    }}>
      <Terminal size={size * 0.45} color="#d4a373" />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   PROFILE SELECTOR
═══════════════════════════════════════════════ */
function ProfileSelector({ active, onSelect }: { active: string; onSelect: (p: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', scrollbarWidth: 'none', padding: '2px 0' }}>
      {PROFILES.map(p => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.7rem',
            fontWeight: p === active ? 600 : 400,
            border: p === active ? '1px solid rgba(212,163,115,0.5)' : '1px solid rgba(255,255,255,0.07)',
            background: p === active ? 'rgba(212,163,115,0.12)' : 'rgba(255,255,255,0.03)',
            color: p === active ? '#d4a373' : 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.12s ease',
            flexShrink: 0,
          }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CHAT BUBBLE
═══════════════════════════════════════════════ */
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      gap: '10px',
      alignItems: 'flex-start',
      marginBottom: '12px',
    }}>
      {!isUser && <AgentAvatar size={32} active />}
      <div style={{
        maxWidth: '72%',
        padding: '11px 15px',
        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        background: isUser
          ? 'linear-gradient(135deg, rgba(120,60,200,0.45) 0%, rgba(90,40,180,0.35) 100%)'
          : 'rgba(255,255,255,0.05)',
        border: isUser
          ? '1px solid rgba(164,100,220,0.3)'
          : '1px solid rgba(255,255,255,0.07)',
        fontSize: '0.83rem',
        lineHeight: 1.55,
        color: isUser ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(8px)',
      }}>
        {msg.content}
      </div>
      {isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <User size={15} color="rgba(255,255,255,0.5)" />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CHAT PANEL
═══════════════════════════════════════════════ */
const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    role: 'agent',
    content: "Hey! Nothing's visibly broken on my end — I'm working fine.\nWhat's up? You having trouble with something specific, or there's an issue with your setup you're running into?",
    timestamp: new Date().toISOString(),
  },
  {
    id: '2',
    role: 'user',
    content: 'working?',
    timestamp: new Date().toISOString(),
  },
];

function ChatPanel({ showAdvanced }: { showAdvanced?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState('default');
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwythos-9b');
  const [targetAgentId, setTargetAgentId] = useState('agent-hermes');
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMsg = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isSending) return;
    // selectedModel and targetAgentId are captured via closure from state

    setMessages(prev => [...prev, {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }]);
    setInput('');
    setIsSending(true);

    try {
      const runRes = await apiFetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: targetAgentId,
          message: content,
          model: selectedModel,
          uiContext: { currentRoute: '/hermes-studio', model: selectedModel },
        }),
      });

      if (!runRes.ok) throw new Error(`HTTP ${runRes.status}`);
      const { runId } = await runRes.json();

      // Stream the response
      const agentMsgId = `a-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: agentMsgId, role: 'agent', content: '', timestamp: new Date().toISOString()
      }]);

      const evtSource = new EventSource(apiUrl(`/api/chat/stream/${runId}`));
      
      evtSource.addEventListener('chat_chunk', (e: any) => {
        try {
          const data = JSON.parse(e.data);
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, content: m.content + (data.chunk ?? '') } : m
          ));
        } catch (err) {}
      });

      evtSource.addEventListener('run_status', (e: any) => {
        try {
          const data = JSON.parse(e.data);
          if (data.status === 'completed' || data.status === 'failed') {
            evtSource.close();
            setIsSending(false);
          }
        } catch (err) {}
      });

      evtSource.onerror = () => { evtSource.close(); setIsSending(false); };
    } catch (err: any) {
      let friendlyError = `Hermes endpoint is unavailable (${err.message}). Check backend routing.`;
      if (err.message.includes('404')) {
        friendlyError = "Hermes endpoint is unavailable (status 404). Check backend routing.";
      }
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'agent',
        content: friendlyError,
        timestamp: new Date().toISOString(),
      }]);
      setIsSending(false);
    }
  }, [input, isSending, selectedModel, targetAgentId]);

  const handleMic = async () => {
    if (isListening) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsListening(true);
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', blob, 'audio.webm');
        try {
          const res = await apiFetch('/api/voice/transcribe', { method: 'POST', body: fd });
          if (res.ok) {
            const { text } = await res.json();
            if (text) { setInput(text); sendMsg(text); }
          }
        } catch { /* swallow */ }
      };
      mr.start();
    } catch { setIsListening(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages area (scrollable) */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 32px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        <div style={{ width: '100%', maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '20px', position: 'relative' }}>
          {/* Clear button */}
          <button
            onClick={() => setMessages([])}
            style={{
              position: 'absolute', top: 0, right: 0,
              padding: '4px 10px', borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '0.7rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              zIndex: 10,
            }}
          >
            <Trash2 size={11} /> Clear
          </button>

          {/* Agent header row */}
          {showAdvanced && (
            <>
              <div style={{ ...S.card({ padding: '14px 18px' }), display: 'flex', alignItems: 'center', gap: '12px' }}>
                <AgentAvatar active />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#d4a373' }}>Hermes</div>
                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>Nous Research Agent · {profile}</div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
                  <span style={{ fontSize: '0.7rem', color: '#22c55e' }}>online</span>
                </div>
              </div>

              {/* Profile selector */}
              <div style={S.card({ padding: '10px 16px' })}>
                <ProfileSelector active={profile} onSelect={setProfile} />
              </div>
            </>
          )}

          {/* Messages list */}
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', marginTop: '40px', fontSize: '0.8rem' }}>
              Chat is empty. Start a conversation.
            </div>
          )}

          {messages.map(msg => <ChatBubble key={msg.id} msg={msg} />)}

          {isSending && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '12px' }}>
              <AgentAvatar size={32} active />
              <div style={{ padding: '11px 15px', borderRadius: '14px 14px 14px 2px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <Loader2 size={14} color="#d4a373" style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* ── Model + Agent picker strip ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '8px 32px 0',
        background: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{ width: '100%', maxWidth: '1100px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Agent toggle */}
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            {STUDIO_AGENTS.map(a => (
              <button
                key={a.id}
                onClick={() => setTargetAgentId(a.id)}
                style={{
                  padding: '4px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.12s',
                  border: targetAgentId === a.id ? `1px solid ${a.color}66` : '1px solid rgba(255,255,255,0.07)',
                  background: targetAgentId === a.id ? `${a.color}18` : 'rgba(255,255,255,0.03)',
                  color: targetAgentId === a.id ? a.color : 'rgba(255,255,255,0.3)',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

          {/* Model selector */}
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', scrollbarWidth: 'none', flex: 1 }}>
            {STUDIO_MODELS.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                style={{
                  padding: '4px 11px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: selectedModel === m.id ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0, whiteSpace: 'nowrap',
                  border: selectedModel === m.id ? `1px solid ${m.color}55` : '1px solid rgba(255,255,255,0.07)',
                  background: selectedModel === m.id ? `${m.color}18` : 'rgba(255,255,255,0.03)',
                  color: selectedModel === m.id ? m.color : 'rgba(255,255,255,0.28)',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input area (anchored footer) */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '12px 32px 20px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.3)',
      }}>
        <div style={{ width: '100%', maxWidth: '1100px' }}>
          <div style={{ ...S.card({ padding: '12px 14px' }), display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMsg(); }}
              placeholder="Message Hermes… (⌘↵ to send)"
              rows={2}
              style={{
                flex: 1, resize: 'none', background: 'transparent',
                border: 'none', outline: 'none',
                color: 'rgba(255,255,255,0.85)', fontSize: '0.83rem',
                fontFamily: 'inherit', lineHeight: 1.5,
                scrollbarWidth: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button onClick={handleMic} style={{
                padding: '8px', borderRadius: '8px',
                border: `1px solid ${isListening ? '#ef444455' : 'rgba(255,255,255,0.08)'}`,
                background: isListening ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                color: isListening ? '#ef4444' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
              <button
                onClick={() => sendMsg()}
                disabled={!input.trim() || isSending}
                style={{
                  padding: '8px 16px', borderRadius: '8px',
                  border: '1px solid rgba(212,163,115,0.3)',
                  background: input.trim() ? 'linear-gradient(135deg, rgba(120,60,200,0.5) 0%, rgba(212,163,115,0.2) 100%)' : 'rgba(255,255,255,0.04)',
                  color: input.trim() ? '#d4a373' : 'rgba(255,255,255,0.25)',
                  cursor: input.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '5px',
                  fontSize: '0.78rem', fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                <Send size={13} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   WEB OS PREVIEW (Workspace mini-OS)
═══════════════════════════════════════════════ */
function WebOSPreview({ selected }: { selected: WorkspaceItem | null }) {
  return (
    <div style={{
      background: '#1a1333',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Titlebar */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.4)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {['#ef4444', '#f59e0b', '#22c55e'].map(c => (
            <div key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginLeft: '6px' }}>
          Web-OS {selected ? `· ${selected.name}` : ''}
        </span>
      </div>
      {/* Content */}
      <div style={{ flex: 1, padding: '12px', position: 'relative' }}>
        {/* Notes window */}
        <div style={{
          position: 'absolute', left: '10%', top: '5%', width: '75%',
          background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px', overflow: 'hidden',
        }}>
          <div style={{
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Notes</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['New', 'Save', 'Autosaves locally'].map(btn => (
                <span key={btn} style={{
                  fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px',
                  background: 'rgba(212,163,115,0.1)', color: '#d4a373',
                  border: '1px solid rgba(212,163,115,0.2)',
                }}>{btn}</span>
              ))}
            </div>
          </div>
          <div style={{ padding: '10px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            <div>Welcome to Web-OS Notes ✨</div>
            <div>Drag this window by its titlebar</div>
            <div>Open Paint from the dock</div>
            <div>Try Terminal: help, date, apps, open paint</div>
          </div>
        </div>
        {/* Dock */}
        <div style={{
          position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '6px',
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px', padding: '6px 10px',
        }}>
          {[MessageSquare, Code2, Terminal, Trash2].map((Icon, i) => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: '6px',
              background: 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon size={13} color="rgba(255,255,255,0.5)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MIXTURE OF AGENTS PANEL
═══════════════════════════════════════════════ */
function MixturePanel() {
  const [prompt, setPrompt] = useState('');
  const [activeModels, setActiveModels] = useState<string[]>(['claude-opus-4.5', 'gpt-5.5', 'synthesizer']);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedWorkspaceItem, setSelectedWorkspaceItem] = useState<WorkspaceItem | null>(WORKSPACE_ITEMS[0]);

  const toggleModel = (id: string) => {
    setActiveModels(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const runPanel = useCallback(async () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    // Simulate panel run
    await new Promise(r => setTimeout(r, 2500));
    setIsRunning(false);
  }, [prompt, isRunning]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runPanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runPanel]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
      {/* Mixture header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em', color: '#fff' }}>Mixture of Agents</div>
          <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px', lineHeight: 1.5 }}>
            A panel of frontier models answers in parallel — a chair model synthesizes one better answer.
          </div>
        </div>
        <div style={{
          padding: '4px 12px', borderRadius: '6px',
          background: 'rgba(192,132,252,0.1)',
          border: '1px solid rgba(192,132,252,0.25)',
          fontSize: '0.65rem', fontWeight: 700,
          color: '#c084fc', letterSpacing: '0.08em',
          textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          <Radio size={10} /> OpenRouter
        </div>
      </div>

      {/* Panel card */}
      <div style={S.card({ padding: '18px' })}>
        <div style={{ ...S.sectionLabel, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Radio size={10} /> The Panel · Live via OpenRouter
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {PANEL_MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => toggleModel(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 14px', borderRadius: '10px',
                border: `1.5px solid ${activeModels.includes(m.id) ? m.color + '66' : 'rgba(255,255,255,0.08)'}`,
                background: activeModels.includes(m.id) ? `${m.color}14` : 'rgba(255,255,255,0.03)',
                color: activeModels.includes(m.id) ? m.color : 'rgba(255,255,255,0.35)',
                cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                transition: 'all 0.15s',
                position: 'relative' as const,
              }}
            >
              {m.chair && (
                <div style={{
                  position: 'absolute', top: -8, right: -8,
                  fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px',
                  background: m.color, color: '#000', borderRadius: '4px',
                  letterSpacing: '0.05em',
                }}>CHAIR</div>
              )}
              <span style={{ fontSize: '0.9rem' }}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt input */}
      <div style={S.card({ padding: '16px' })}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Ask the panel anything… (⌘↵ to run)"
          rows={5}
          style={{
            width: '100%', resize: 'none', background: 'transparent',
            border: 'none', outline: 'none',
            color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem',
            fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <button
            onClick={runPanel}
            disabled={isRunning}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '9px 20px', borderRadius: '9px',
              background: 'linear-gradient(135deg, rgba(120,60,200,0.6) 0%, rgba(180,120,255,0.4) 100%)',
              border: '1px solid rgba(192,132,252,0.4)',
              color: '#c084fc', fontSize: '0.8rem', fontWeight: 700,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {isRunning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
            Run the panel
          </button>
          {QUICK_PROMPTS.map(qp => (
            <button
              key={qp}
              onClick={() => setPrompt(qp)}
              style={{
                padding: '9px 14px', borderRadius: '9px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.45)', fontSize: '0.74rem',
                cursor: 'pointer', transition: 'all 0.15s',
                maxWidth: '200px', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {qp}
            </button>
          ))}
        </div>
      </div>

      {/* Workspace preview */}
      <div style={{ ...S.card(), overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={15} color="rgba(255,255,255,0.4)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
              Workspace — everything the panel has made
            </span>
          </div>
          <div style={{
            fontSize: '0.68rem', padding: '2px 8px', borderRadius: '5px',
            background: 'rgba(212,163,115,0.1)', color: '#d4a373',
            border: '1px solid rgba(212,163,115,0.2)',
            fontWeight: 700,
          }}>
            42 builds
          </div>
        </div>
        {/* Two-column layout */}
        <div style={{ display: 'flex', height: '260px' }}>
          {/* List */}
          <div style={{
            width: '220px', borderRight: '1px solid rgba(255,255,255,0.06)',
            overflowY: 'auto', scrollbarWidth: 'none',
          }}>
            {WORKSPACE_ITEMS.map(item => (
              <div
                key={item.id}
                onClick={() => setSelectedWorkspaceItem(item)}
                style={{
                  padding: '9px 16px',
                  cursor: 'pointer',
                  fontSize: '0.76rem',
                  color: selectedWorkspaceItem?.id === item.id ? '#d4a373' : 'rgba(255,255,255,0.45)',
                  background: selectedWorkspaceItem?.id === item.id ? 'rgba(212,163,115,0.08)' : 'transparent',
                  borderLeft: selectedWorkspaceItem?.id === item.id ? '2px solid #d4a373' : '2px solid transparent',
                  transition: 'all 0.12s',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {item.name}
              </div>
            ))}
          </div>
          {/* Preview */}
          <div style={{ flex: 1, padding: '10px' }}>
            <WebOSPreview selected={selectedWorkspaceItem} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   STUDIO TAB PLACEHOLDER
═══════════════════════════════════════════════ */
export function WorkflowsPanel() {
  const mutations = useKanbanMutations();
  const workflows = [
    { id: 'wf-jarvis-pipeline', name: 'Jarvis Default Pipeline', desc: 'Main task decomposition and execution flow.', agent: 'Jarvis Core' },
    { id: 'wf-heavy-gen', name: 'Heavy Generation', desc: 'Code generation intensive workflow using Opus/Qwable.', agent: 'Forge' },
    { id: 'wf-kanban-automation', name: 'Kanban Automation', desc: 'Auto-triage and status updates for Kanban lanes.', agent: 'Scout' },
  ];

  const handleRun = (wfId: string) => {
    if (wfId === 'wf-kanban-automation') {
      mutations.addTask('l-hermes-backlog', {
        title: 'Auto-Triage Complete',
        body: 'Scout has reviewed the backlog and prioritized items.',
        order: Date.now(),
        agent: 'Scout',
        model: 'qwythos:9b'
      });
      alert('Triggered Kanban Automation: Triage task created in Hermes Workspace.');
    } else {
      alert(`Triggered workflow: ${wfId}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', height: '100%', overflowY: 'auto' }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Active Workflows</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {workflows.map(wf => (
          <div key={wf.id} className="workflow-card" style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '12px', padding: '20px', transition: 'all 0.2s', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{wf.name}</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{wf.id}</div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, flex: 1 }}>{wf.desc}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
              <span style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'rgba(168,85,247,0.1)', color: '#a855f7', borderRadius: '4px', fontWeight: 600 }}>{wf.agent}</span>
              <button 
                onClick={(e) => { e.stopPropagation(); handleRun(wf.id); }}
                style={{
                  background: '#a855f7', color: '#fff', border: 'none', borderRadius: '6px',
                  padding: '6px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                <Play size={14} /> Run
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudioPlaceholder({ tab }: { tab: StudioTab }) {
  const icons: Record<string, React.ReactNode> = {
    'Talk': <Mic size={28} color="rgba(255,255,255,0.2)" />,
    'Hermes-Jarvis': <ArrowRight size={28} color="rgba(255,255,255,0.2)" />,
    'Hermes Oracle': <Brain size={28} color="rgba(255,255,255,0.2)" />,
    'Studio': <MonitorPlay size={28} color="rgba(255,255,255,0.2)" />,
    'Sessions': <Layers size={28} color="rgba(255,255,255,0.2)" />,
    'Outreach': <Globe size={28} color="rgba(255,255,255,0.2)" />,
    'Workspace': <FolderOpen size={28} color="rgba(255,255,255,0.2)" />,
    'MCPs': <Cpu size={28} color="rgba(255,255,255,0.2)" />,
    'Manage': <SlidersHorizontal size={28} color="rgba(255,255,255,0.2)" />,
    'Control Room': <Radio size={28} color="rgba(255,255,255,0.2)" />,
    'Goal Mode': <Zap size={28} color="rgba(255,255,255,0.2)" />,
  };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: '12px',
      color: 'rgba(255,255,255,0.2)',
    }}>
      {icons[tab] ?? <Settings size={28} color="rgba(255,255,255,0.2)" />}
      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{tab}</div>
      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.12)' }}>Coming soon — this studio module is in progress.</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════ */
export default function HermesStudio() {
  const [activeTab, setActiveTab] = useState<StudioTab>('Workflows');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const navigate = useNavigate();

  const renderTabContent = () => {
    switch (activeTab) {
      case 'Chat': return <ChatPanel showAdvanced={showAdvanced} />;
      case 'Mixture': return <MixturePanel />;
      case 'Workflows': return <WorkflowsPanel />;
      case 'Review Queue': return <ReviewQueuePanel />;
      default: return <StudioPlaceholder tab={activeTab} />;
    }
  };

  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={S.title}>Hermes</h1>
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.5)', padding: '4px 8px', borderRadius: '4px',
                fontSize: '0.65rem', cursor: 'pointer', transition: 'all 0.15s'
              }}
            >
              {showAdvanced ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          {showAdvanced && (
            <>
              <p style={S.subtitle}>Nous Research agent. Sessions, skills, kanban — and a chat line.</p>
              <div style={S.meta}>
                <span style={S.metaBadge('#d4a373')}>v1.1.8</span>
                <span style={S.metaBadge('#22c55e')}>LOCAL</span>
                <span style={S.metaBadge('#c084fc')}>STUDIO</span>
              </div>
            </>
          )}
        </div>
        {/* Header Right */}
        <div style={S.headerBtns}>
          <button onClick={() => navigate('/hermes')} style={{ ...S.topBtn, background: 'rgba(192, 132, 252, 0.15)', borderColor: 'rgba(192, 132, 252, 0.3)', color: '#e9d5ff' }}>
            <PanelLeft size={14} /> Open Hermes Workspace
          </button>
          <button onClick={() => setShowAdvanced(!showAdvanced)} style={S.topBtn}>
            <SlidersHorizontal size={14} /> {showAdvanced ? 'Simple' : 'Advanced'}
          </button>
          <button style={S.topBtn}>
            <Settings size={14} /> Settings
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={S.tabBar}>
        {STUDIO_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={S.tab(activeTab === tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <style>{`
        .workflow-card:hover {
          border-color: #a855f7 !important;
          background: rgba(168, 85, 247, 0.05) !important;
        }
      `}</style>

      {/* ── Content ── */}
      <div style={S.content}>
        {renderTabContent()}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

