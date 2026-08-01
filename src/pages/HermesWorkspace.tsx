import React, { useState, useEffect } from 'react';
import HermesKanbanBoard from '../components/HermesKanbanBoard';
import HermesContextPanel from '../components/HermesContextPanel';
import { Send, Zap, Kanban, Cpu, Mic } from 'lucide-react';
import { useChatManager } from '../hooks/useChatManager';
import { useKanbanMutations } from '../lib/dataport';
import { useSearchParams } from 'react-router-dom';
import HermesComposer from '../components/hermes/HermesComposer';
import { WorkflowsPanel } from './HermesStudio';
import ApolloWallMode from './ApolloWallMode';

const HermesWorkspace: React.FC = () => {
  const mutations = useKanbanMutations();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('view') || 'kanban';

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
              <HermesKanbanBoard />
            </div>

            {/* Right: Hermes context panel */}
            <div className="w-1/4">
              <HermesContextPanel />
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
        <HermesComposer />
      )}
    </div>
  );
};

export default HermesWorkspace;
