import React, { useState, useRef, useEffect } from 'react';
import { Send, Zap, AlertTriangle } from 'lucide-react';
import { apiFetch, apiUrl } from '../api/client';

interface Msg { 
  role: 'user' | 'assistant'; 
  text: string; 
  metadata?: { modelUsed?: string; fallbackApplied?: boolean; fallbackReason?: string };
}

const HermesChatView: React.FC = () => {
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
      const res = await apiFetch('/api/chat/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      setMsgs(m => [...m, { 
        role: 'assistant', 
        text: data.reply || data.error || 'No response',
        metadata: data.metadata
      }]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0F172A] rounded-xl border border-slate-800 overflow-hidden text-slate-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 bg-[#0B1121]">
        <Zap size={16} className="text-purple-500" />
        <span className="text-sm font-semibold text-slate-300 tracking-wide">
          HERMES COMMAND CHAT
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {msgs.length === 0 && (
          <div className="text-slate-500 text-sm italic m-auto text-center">
            Type a message below to command Hermes.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex flex-col max-w-[85%] ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
            <div className={`p-3 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-200 rounded-bl-sm'
            }`}>
              {m.text}
            </div>
            {m.metadata && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                {m.metadata.fallbackApplied ? (
                  <span className="flex items-center gap-1 text-amber-500/80">
                    <AlertTriangle size={10} />
                    OmniRoute failed ({m.metadata.fallbackReason}), fell back to {m.metadata.modelUsed}
                  </span>
                ) : (
                  <span>Ran with {m.metadata.modelUsed || 'OmniRoute'}</span>
                )}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="self-start text-slate-500 text-xs italic px-2">
            Hermes is thinking…
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Input */}
      <div className="p-3 bg-[#0B1121] border-t border-slate-800 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Command Hermes..."
          disabled={loading}
          className="flex-1 bg-[#020617] border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-slate-600"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default HermesChatView;

