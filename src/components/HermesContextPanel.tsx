import React, { useState, useEffect } from 'react';
import { API_BASE } from '../api/client';
import { AgentRuntimeSelector } from './agents/AgentRuntimeSelector';


interface HermesContextPanelProps {}

interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  scopeId: string;
}

const HermesContextPanel: React.FC<HermesContextPanelProps> = () => {
  const [memory, setMemory] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    const fetchMemory = async () => {
      try {
        const [wsRes, sessRes] = await Promise.all([
          fetch(`${API_BASE}/memory/entries?scopeId=mem-workspace`),
          fetch(`${API_BASE}/memory/entries?scopeId=mem-session`)
        ]);
        const wsData = await wsRes.json();
        const sessData = await sessRes.json();
        setMemory([...(Array.isArray(wsData) ? wsData : []), ...(Array.isArray(sessData) ? sessData : [])]);
      } catch (err) {
        console.error('Failed to fetch Hermes workspace memory', err);
      }
    };
    fetchMemory();
    // Poll every 5s for updates
    const interval = setInterval(fetchMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#111827]/80 backdrop-blur-sm rounded-2xl p-5 shadow-2xl border border-slate-800 flex flex-col h-full overflow-hidden">
      <div className="mb-6">
        <h3 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-3">Model Selector</h3>
          <div className="pt-2">
            <AgentRuntimeSelector agentId="agent-hermes" />
          </div>
      </div>
      
      <div className="mb-6">
        <h3 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-3">Active System Prompt</h3>
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-300 leading-relaxed font-mono">
            You are Hermes, the primary orchestrator for the Agentic OS. Your role is to break down complex tasks and delegate them across the Kanban pipeline.
          </p>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col min-h-0">
        <h3 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-3">Workspace & Session Memory</h3>
        <div className="flex-1 overflow-y-auto pr-2 space-y-3" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.05) transparent' }}>
          {memory.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No memory entries found.</p>
          ) : (
            memory.map(entry => (
              <div key={entry.id} className="bg-[#0F172A] border border-slate-800 rounded-xl p-3 hover:border-slate-600 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-purple-400 font-bold uppercase">{entry.scopeId === 'mem-workspace' ? 'Workspace' : 'Session'}</span>
                </div>
                <h4 className="text-sm font-semibold text-slate-200 mb-1">{entry.title}</h4>
                <p className="text-xs text-slate-400 line-clamp-3">{entry.content}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default HermesContextPanel;

