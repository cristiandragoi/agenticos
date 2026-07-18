import React, { useState, useEffect } from 'react';
import HermesKanbanBoard from '../components/HermesKanbanBoard';
import HermesContextPanel from '../components/HermesContextPanel';
import { Send, Zap, Kanban, Cpu, Mic } from 'lucide-react';
import { useChatManager } from '../hooks/useChatManager';
import { useKanbanMutations } from '../lib/dataport';
import { useSearchParams } from 'react-router-dom';
import { WorkflowsPanel } from './HermesStudio';
import ApolloWallMode from './ApolloWallMode';

const HermesWorkspace: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [targetAgent, setTargetAgent] = useState('auto');
  const [selectedModel, setSelectedModel] = useState('qwythos:9b');
  const { sendMessage, isTyping } = useChatManager();
  const mutations = useKanbanMutations();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('view') || 'kanban';

  useEffect(() => {
    mutations.updateLaneConfig('l-hermes-inprogress-hermes', { model: selectedModel });
  }, [selectedModel]);

  const handleSend = () => {
    if (!inputValue.trim() || isTyping) return;
    sendMessage(inputValue.trim(), targetAgent);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const setTab = (tab: string) => {
    setSearchParams({ view: tab });
  };

  return (
    <div className="flex flex-col min-h-full bg-[#0F172A] relative">
      {/* Subheader / Tabs bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#020617]/40 border-b border-slate-800/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-wider uppercase text-purple-400">Hermes Studio Hub</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('kanban')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
              activeTab === 'kanban'
                ? 'bg-purple-600/10 border-purple-500/50 text-purple-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Kanban size={14} /> Hermes Workspace
          </button>
          <button
            onClick={() => setTab('studio')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
              activeTab === 'studio'
                ? 'bg-purple-600/10 border-purple-500/50 text-purple-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu size={14} /> Hermes Studio
          </button>
          <button
            onClick={() => setTab('apollo')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
              activeTab === 'apollo'
                ? 'bg-purple-600/10 border-purple-500/50 text-purple-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic size={14} /> Hermes Apollo
          </button>
        </div>
      </div>

      {/* Main Content Area based on Active Tab */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {activeTab === 'kanban' && (
          <div className="flex flex-1 overflow-hidden px-4 pt-4 pb-20">
            {/* Left: Kanban board */}
            <div className="w-3/4 pr-4">
              <HermesKanbanBoard selectedModel={selectedModel} />
            </div>

            {/* Right: Hermes context panel */}
            <div className="w-1/4">
              <HermesContextPanel selectedModel={selectedModel} setSelectedModel={setSelectedModel} />
            </div>
          </div>
        )}

        {activeTab === 'studio' && (
          <div className="flex-1 p-4">
            <WorkflowsPanel />
          </div>
        )}

        {activeTab === 'apollo' && (
          <div className="flex-1 p-4">
            <ApolloWallMode />
          </div>
        )}
      </div>

      {/* Bottom chat bar only visible on Kanban tab */}
      {activeTab === 'kanban' && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-[#111827]/90 backdrop-blur-md border-t border-slate-800 z-10">
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
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything or request a task..."
                disabled={isTyping}
                className="w-full bg-[#0F172A] border border-slate-700 text-slate-200 text-sm rounded-xl pl-4 pr-12 py-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-slate-500"
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
      )}
    </div>
  );
};

export default HermesWorkspace;
