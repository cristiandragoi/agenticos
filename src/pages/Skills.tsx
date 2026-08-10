import React, { useState, useEffect } from 'react';
import { Layers, Plus, TerminalSquare, CheckCircle, XCircle } from 'lucide-react';
import type { AgentSkill } from '../../shared/types/skill';
import { apiFetch, apiUrl } from '../api/client';

export default function Skills() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/skills')
      .then(r => r.json())
      .then(data => {
        setSkills(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex flex-col h-full w-full p-8" style={{ backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.9), rgba(10, 10, 12, 0.98)), url('/bg/bg_runs.png')", backgroundSize: 'cover', backgroundAttachment: 'fixed' }}>
      
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Layers size={32} className="text-purple-500" /> Skill Registry
          </h1>
          <p className="text-sm text-slate-400 mt-2">Manage the foundational tools and capabilities available to agents.</p>
        </div>
        <button className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
          <Plus size={18} /> New Skill
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-slate-500 animate-pulse">Loading skills...</div>
        ) : skills.length === 0 ? (
          <div className="text-slate-500 italic">No skills registered.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {skills.map(skill => (
              <div key={skill.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-purple-500/50 transition-colors flex flex-col">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                    <TerminalSquare size={18} className="text-slate-400" /> {skill.name}
                  </h3>
                  {skill.active ? (
                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle size={10}/> Active
                    </span>
                  ) : (
                    <span className="bg-slate-500/20 text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-slate-500/30 flex items-center gap-1">
                      <XCircle size={10}/> Inactive
                    </span>
                  )}
                </div>
                
                <p className="text-xs text-slate-400 mb-6 flex-1">{skill.description || 'No description provided.'}</p>
                
                <div className="flex flex-col gap-2 mt-auto border-t border-slate-800/50 pt-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Agent Binding</span>
                    <span className="text-slate-300 font-semibold">{skill.agentId || 'Omni'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Model Preference</span>
                    <span className="text-slate-300 font-mono text-[10px] bg-slate-950 px-1.5 py-0.5 rounded">{skill.modelHint || 'Auto'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Internal Tool ID</span>
                    <span className="text-slate-500 font-mono text-[10px]">{skill.toolId || '-'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
    </div>
  );
}

