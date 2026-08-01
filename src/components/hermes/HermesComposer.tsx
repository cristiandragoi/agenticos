import React, { useState } from 'react';
import { Send, Zap } from 'lucide-react';
import { useChatManager } from '../../hooks/useChatManager';

interface HermesComposerProps {
  onSend?: () => void;
}

const HermesComposer: React.FC<HermesComposerProps> = ({ onSend }) => {
  const [inputValue, setInputValue] = useState('');
  const [targetAgent, setTargetAgent] = useState('auto');
  const { sendMessage, isTyping } = useChatManager();

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;
    const text = inputValue.trim();
    const success = await sendMessage(text, targetAgent);
    if (success) {
      setInputValue('');
      if (onSend) onSend();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault();
        setInputValue(inputValue + '\n');
      } else {
        e.preventDefault();
        handleSend();
      }
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 py-2 z-10 bg-[#111827]/90 backdrop-blur-md border-t border-slate-800">
      <div className="max-w-5xl mx-auto flex gap-3 px-4">
        <div className="flex items-center bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-1 flex-shrink-0">
          <Zap size={14} className="text-purple-500 mr-2" />
          <select
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            className="bg-transparent text-slate-300 text-sm font-medium outline-none cursor-pointer appearance-none pr-4"
          >
            <option value="auto">Auto-route</option>
            <option value="agent-hermes">Hermes</option>
            <option value="agent-jarvis">Jarvis</option>
            <option value="agent-welders">Welders</option>
          </select>
        </div>

        <div className="flex-1 relative">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or request a task..."
            disabled={isTyping}
            rows={1}
            className="w-full bg-[#0F172A] border border-slate-700 text-slate-200 text-sm rounded-xl pl-4 pr-12 py-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-slate-500 resize-none overflow-hidden"
            style={{ minHeight: '46px', maxHeight: '150px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isTyping}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(HermesComposer);
