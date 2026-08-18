import React, { useState, useEffect, useRef } from 'react';
import { Activity, Send, AlertTriangle } from 'lucide-react';
import { useHermesStore } from '../store/hermesStore';
import ErrorBoundary from '../components/ErrorBoundary';
import { apiFetch, apiUrl } from '../api/client';

interface RunRecord {
  id: string;
  status: string;
  input: any;
  output?: any;
  createdAt: string;
}

const HermesApolloView: React.FC = () => {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  
  const { getStats } = useHermesStore();
  const stats = getStats();
  const bottom = useRef<HTMLDivElement>(null);

  const fetchRuns = () => {
    apiFetch('/api/runs?agentId=agent-hermes')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch runs');
        return res.json();
      })
      .then((data) => {
        setRuns(data.reverse()); // Show oldest first for chat flow
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runs, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    
    try {
      // Send chat command
      await apiFetch('/api/chat/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      // Refresh runs to get the new chat history
      fetchRuns();
    } catch (e: any) {
      console.error("Chat error:", e);
    } finally {
      setSending(false);
    }
  };

  const parseMessageContent = (data: any, field: 'prompt' | 'reply' | 'error') => {
    if (!data) return '';
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed[field] || parsed.result || data;
      } catch {
        return data;
      }
    }
    return data[field] || data.result || JSON.stringify(data);
  };

  return (
    <div className="flex-col h-full bg-surface border border-subtle rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
      {/* Stats Header */}
      <div className="flex-row gap-4 p-4 border-b" style={{ borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}>
        <div className="flex-row items-center gap-2" style={{ flexShrink: 0, marginRight: '16px' }}>
          <Activity size={16} style={{ color: 'var(--color-info)' }} />
          <div>
            <h2 className="text-sm font-semibold">Hermes Apollo</h2>
            <p className="text-xs text-dim mt-1">Live execution history & command chat</p>
          </div>
        </div>
        <div className="flex-1 flex-row gap-4" style={{ flexShrink: 0 }}>
          <div className="flex-1 flex-col items-center p-2" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <span className="nav-section-label" style={{ padding: 0 }}>Backlog</span>
            <span className="text-sm font-bold">{stats['backlog']}</span>
          </div>
          <div className="flex-1 flex-col items-center p-2" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <span className="nav-section-label" style={{ padding: 0 }}>In Progress</span>
            <span className="text-sm font-bold" style={{ color: 'var(--color-info)' }}>{stats['in_progress']}</span>
          </div>
          <div className="flex-1 flex-col items-center p-2" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <span className="nav-section-label" style={{ padding: 0 }}>Review</span>
            <span className="text-sm font-bold" style={{ color: 'var(--color-warning)' }}>{stats['review']}</span>
          </div>
          <div className="flex-1 flex-col items-center p-2" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <span className="nav-section-label" style={{ padding: 0 }}>Done</span>
            <span className="text-sm font-bold" style={{ color: 'var(--color-success)' }}>{stats['done']}</span>
          </div>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 flex-col gap-4">
        {loading ? (
          <div className="text-center text-dim text-sm italic mt-10">Loading Apollo records...</div>
        ) : error ? (
          <div className="text-center text-sm mt-10" style={{ color: 'var(--color-error)' }}>{error}</div>
        ) : runs.length === 0 ? (
          <div className="text-center text-dim text-sm italic mt-10">No chat history. Type a command to begin.</div>
        ) : (
          runs.map((run) => {
            const promptText = parseMessageContent(run.input, 'prompt');
            const replyText = run.output ? parseMessageContent(run.output, run.status === 'failed' ? 'error' : 'reply') : null;

            return (
              <React.Fragment key={run.id}>
                {/* User Message */}
                {promptText && (
                  <div className="chat-message chat-message--user">
                    <div className="flex-col items-end">
                      <div className="chat-message__bubble">{promptText}</div>
                      <div className="text-xxs text-dim mt-1">{new Date(run.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                )}
                
                {/* Agent Reply */}
                {replyText && (
                  <div className="chat-message chat-message--agent">
                    <div className="flex-col items-start">
                      <div className="chat-message__bubble">
                        {run.status === 'failed' && <AlertTriangle size={12} className="inline mr-1" style={{ color: 'var(--color-error)' }}/>}
                        {replyText}
                      </div>
                      <div className="text-xxs text-dim mt-1 flex-row gap-2">
                        <span>Hermes Apollo</span>
                        <span>•</span>
                        <span className={`status-badge status-badge--${run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'info'}`} style={{ padding: '1px 4px', fontSize: '0.625rem' }}>
                          {run.status}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
        {sending && (
          <div className="chat-message chat-message--agent">
            <div className="chat-message__bubble italic text-dim">Hermes is thinking...</div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Text Input */}
      <div className="chat-dock__composer" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Send a command to Hermes..."
          disabled={sending || loading}
          className="chat-dock__input"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="search-trigger"
          style={{ background: 'var(--color-kind-llm)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 'var(--radius-full)' }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

const HermesApolloViewWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <HermesApolloView />
  </ErrorBoundary>
);

export default HermesApolloViewWithErrorBoundary;

