import React, { useEffect, useState } from 'react';
import HermesKanbanBoard from '../components/HermesKanbanBoard';
import HermesContextPanel from '../components/HermesContextPanel';
import { Send, Zap } from 'lucide-react';
import { useChatManager } from '../hooks/useChatManager';
import { useKanbanMutations } from '../lib/dataport';

const HermesKanbanView: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [targetAgent, setTargetAgent] = useState('auto');
  const { sendMessage, isTyping } = useChatManager();
  const mutations = useKanbanMutations();

  useEffect(() => {
  }, []);

  const handleSend = async () => {
    console.log('[HermesSubmit] handleSend-start', { inputValue, isTyping, targetAgent });
    const text = inputValue.trim();
  
    if (!text || isTyping) {
      console.log('[HermesSubmit] error - early return', { text, isTyping });
      return;
    }
  
    console.log('[HermesSubmit] sendMessage-start', { text, targetAgent });
    try {
      const success = await sendMessage(text, targetAgent);
      console.log('[HermesSubmit] sendMessage-result', success);
    
      if (success) {
        setInputValue('');
      }
    } catch (err) {
      console.log('[HermesSubmit] error', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      console.log('[HermesSubmit] keydown - Enter pressed', { shiftKey: e.shiftKey });
      if (e.shiftKey) {
        // Shift + Enter creates a newline
        e.preventDefault();
        setInputValue(inputValue + '\n');
      } else {
        // Enter submits the message
        e.preventDefault();
        handleSend();
      }
    }
  };

  return (
    <div className="flex flex-col h-full relative text-white">
      <div className="flex flex-1 overflow-hidden pb-16">
        {/* Left: Kanban board */}
        <div className="w-3/4 pr-4">
          <HermesKanbanBoard />
        </div>

        {/* Right: Hermes context panel */}
        <div className="w-1/4">
          <HermesContextPanel />
        </div>
      </div>

      {/* Bottom: auto-route bar (command input) */}
      <div className="absolute bottom-0 left-0 right-0 py-2">
        <div className="max-w-5xl mx-auto flex gap-3">
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
              onClick={(e) => {
                console.log('[HermesSubmit] click');
                handleSend();
              }}
              disabled={!inputValue.trim() || isTyping}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HermesKanbanView;
