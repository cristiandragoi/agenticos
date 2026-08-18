import React, { useState, useRef, useEffect } from 'react';
import { apiFetch, apiUrl } from '../api/client';

interface Msg { role: 'user' | 'assistant'; text: string }

const QuickChat: React.FC = () => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await apiFetch('/api/chat/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMsgs(m => [...m, { role: 'assistant', text: data.reply || data.error || 'No response' }]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-secondary, #0F172A)', borderRadius: '12px',
      border: '1px solid var(--border-subtle, #1e293b)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border-subtle, #1e293b)',
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)', letterSpacing: '0.05em' }}>
          QUICK CHAT · OmniRoute (auto)
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {msgs.length === 0 && (
          <div style={{ color: '#475569', fontSize: '13px', fontStyle: 'italic', margin: 'auto', textAlign: 'center' }}>
            Type a message below to chat with OmniRoute's free AI.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%', padding: '8px 12px', borderRadius: '10px',
            background: m.role === 'user' ? '#6366f1' : '#1e293b',
            color: m.role === 'user' ? '#fff' : '#e2e8f0',
            fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap',
          }}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '12px', fontStyle: 'italic' }}>
            Thinking…
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border-subtle, #1e293b)',
        display: 'flex', gap: '8px',
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask anything…"
          disabled={loading}
          style={{
            flex: 1, background: '#020617', border: '1px solid #334155', borderRadius: '8px',
            padding: '8px 12px', color: '#e2e8f0', fontSize: '13px', outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{
            padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: input.trim() && !loading ? '#6366f1' : '#334155',
            color: '#fff', fontSize: '13px', fontWeight: 600, transition: 'background 0.2s',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default QuickChat;
