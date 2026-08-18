import React, { useState } from 'react';
import { Play, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useHermesStore } from '../store/hermesStore';
import GatewayStatusChip from '../components/GatewayStatusChip';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, apiUrl } from '../api/client';

const HermesStudioView: React.FC = () => {
  const { addTask } = useHermesStore();
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [metadata, setMetadata] = useState<{ modelUsed?: string; fallbackApplied?: boolean; fallbackReason?: string } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const selectedWorkflow = searchParams.get('workflow');

  const [recentRuns, setRecentRuns] = useState([
    { id: 'run-1', workflowId: 'wf-jarvis-pipeline', name: 'Jarvis Default Pipeline', status: 'Hermes card run OK', time: 'Just now', metadata: null as any },
    { id: 'run-2', workflowId: 'wf-kanban-automation', name: 'Kanban Automation', status: 'Scout reviewed backlog', time: '10m ago', metadata: null },
    { id: 'run-3', workflowId: 'wf-heavy-gen', name: 'Heavy Generation', status: 'Failed (timeout)', time: '1h ago', metadata: null }
  ]);

  const templates = [
    { id: 'tpl-1', name: 'API Scaffolding', desc: 'Generate CRUD endpoints quickly.' },
    { id: 'tpl-2', name: 'React Component', desc: 'Create a fully styled functional component.' },
  ];

  const workflows = [
    { id: 'wf-jarvis-pipeline', name: 'Jarvis Default Pipeline', desc: 'Main task decomposition and execution flow.', agent: 'Jarvis Core' },
    { id: 'wf-heavy-gen', name: 'Heavy Generation', desc: 'Code generation intensive workflow using Opus/Qwable.', agent: 'Forge' },
    { id: 'wf-kanban-automation', name: 'Kanban Automation', desc: 'Auto-triage and status updates for Kanban lanes.', agent: 'Scout' },
  ];

  const handleRun = async (wfId: string) => {
    const wfObj = workflows.find(w => w.id === wfId);
    if (!wfObj) return;

    const addRunLog = (status: string, meta: any) => {
      setRecentRuns(prev => [
        { id: `run-${Date.now()}`, workflowId: wfId, name: wfObj.name, status, time: 'Just now', metadata: meta },
        ...prev
      ]);
    };

    if (wfId === 'wf-jarvis-pipeline') {
      setRunning(true);
      setResult('Calling OmniRoute...');
      setMetadata(null);
      try {
        const res = await apiFetch('/api/chat/studio-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: wfId, prompt: 'Execute Jarvis Default Pipeline: decompose and run.' }),
        });
        const data = await res.json();
        const finalStatus = data.reply || data.error || 'Hermes card run OK';
        setResult(finalStatus);
        setMetadata(data.metadata || { modelUsed: 'OmniRoute' });
        addRunLog(finalStatus, data.metadata);
        
        addTask({
          title: 'Jarvis Pipeline Output',
          description: finalStatus,
          status: 'backlog',
          agent: 'Jarvis Core',
          model: data.metadata?.modelUsed || 'OmniRoute',
          fallbackApplied: data.metadata?.fallbackApplied,
          fallbackReason: data.metadata?.fallbackReason,
        });

      } catch (err: any) {
        setResult(`Error: ${err.message}`);
        addRunLog(`Error: ${err.message}`, null);
      } finally {
        setRunning(false);
      }
    } else if (wfId === 'wf-kanban-automation') {
      addTask({
        title: 'Auto-Triage Complete',
        description: 'Scout has reviewed the backlog and prioritized items.',
        status: 'backlog',
        agent: 'Scout',
        model: 'qwythos:9b'
      });
      alert('Triggered Kanban Automation: Triage task created in Hermes Workspace.');
      setResult('Triage task created');
      addRunLog('Triage task created', { modelUsed: 'qwythos:9b' });
    } else {
      alert(`Triggered workflow: ${wfId}`);
      setResult(`Simulated run complete for ${wfId}`);
      addRunLog(`Simulated run complete`, null);
    }
  };

  const handleViewDetails = (wfId: string) => {
    const params = new URLSearchParams(location.search);
    params.set('workflow', wfId);
    navigate({ pathname: '/hermes-studio', search: `?${params.toString()}` });
  };

  const handleBack = () => {
    const params = new URLSearchParams(location.search);
    params.delete('workflow');
    navigate({ pathname: '/hermes-studio', search: `?${params.toString()}` });
  };

  const selectedWfObj = workflows.find(w => w.id === selectedWorkflow);

  if (selectedWfObj) {
    const workflowRuns = recentRuns.filter(r => r.workflowId === selectedWfObj.id);

    return (
      <div className="flex flex-col gap-4 h-full overflow-y-auto text-white p-2">
        <button 
          onClick={handleBack}
          className="self-start text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={14} /> Back to Studio
        </button>
        <h2 className="text-2xl font-bold">{selectedWfObj.name}</h2>
        <div className="text-sm text-slate-400 max-w-2xl">{selectedWfObj.desc}</div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col gap-4 max-w-2xl mt-2">
          <GatewayStatusChip />
          <div className="bg-slate-900 rounded p-4 font-mono text-sm text-emerald-400 border border-emerald-500/20">
            {result || 'Ready to run'}
            {metadata && (
              <div className="mt-2 text-xs text-slate-400 border-t border-slate-700/50 pt-2 flex items-center gap-1">
                {metadata.fallbackApplied ? (
                  <span className="flex items-center gap-1 text-amber-500/80">
                    <AlertTriangle size={12} />
                    Fallback to {metadata.modelUsed} ({metadata.fallbackReason})
                  </span>
                ) : (
                  <span>Model: {metadata.modelUsed}</span>
                )}
              </div>
            )}
          </div>
          
          <h3 className="text-lg font-semibold mt-4 border-b border-white/10 pb-2">Recent Execution Logs</h3>
          <ul className="list-disc list-inside text-sm text-slate-300 space-y-2">
            {workflowRuns.length > 0 ? (
              workflowRuns.map(run => (
                <li key={run.id} className="flex flex-col gap-1">
                  <div>
                    <span className="text-slate-400 mr-2">[{run.time}]</span>
                    <span>{run.status}</span>
                  </div>
                  {run.metadata && (
                    <div className="ml-5 text-[10px] text-slate-500">
                      {run.metadata.fallbackApplied 
                        ? <span className="text-amber-500/70">⚠ Fallback: {run.metadata.modelUsed}</span>
                        : `Ran with ${run.metadata.modelUsed}`}
                    </div>
                  )}
                </li>
              ))
            ) : (
              <li className="text-slate-500 italic">No recent runs.</li>
            )}
          </ul>

          <button 
            onClick={() => handleRun(selectedWfObj.id)}
            disabled={running}
            className="mt-4 self-start bg-purple-500 hover:bg-purple-600 text-white border-none rounded-md px-4 py-2 text-sm font-semibold cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running ? 'Running…' : 'Run Pipeline'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-full overflow-hidden text-white p-2">
      {/* Column 1: Active Workflows */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0F172A] rounded-xl border border-slate-800 p-4">
        <h2 className="text-sm font-bold mb-4 text-slate-200">Active Workflows</h2>
        <div className="flex flex-col gap-3 overflow-y-auto pr-2 pb-4">
          {workflows.map(wf => {
            return (
              <div key={wf.id} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-purple-500/10 hover:border-purple-500/50 transition-all flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-semibold mb-1">{wf.name}</div>
                    <div className="text-[10px] text-white/50 font-mono">{wf.id}</div>
                  </div>
                  <button 
                    onClick={() => handleViewDetails(wf.id)}
                    className="text-[10px] text-purple-400 hover:text-purple-300 underline"
                  >
                    View details
                  </button>
                </div>
                <GatewayStatusChip />
                <p className="text-xs text-white/70">{wf.desc}</p>
                {result && (
                  <div className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-1 font-mono">
                    {result}
                  </div>
                )}
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[10px] px-2 py-1 bg-purple-500/10 text-purple-400 rounded font-semibold">{wf.agent}</span>
                  <button 
                    onClick={() => handleRun(wf.id)}
                    disabled={running}
                    className="bg-purple-500 hover:bg-purple-600 text-white border-none rounded px-2 py-1 text-[10px] font-semibold cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {running ? 'Running…' : 'Run'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Column 2: Recent Runs */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0F172A] rounded-xl border border-slate-800 p-4">
        <h2 className="text-sm font-bold mb-4 text-slate-200">Recent Runs</h2>
        <div className="flex flex-col gap-2 overflow-y-auto pr-2 pb-4">
          {recentRuns.map(run => (
            <div key={run.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-semibold">{run.name}</span>
                <span className="text-[10px] text-slate-500">{run.time}</span>
              </div>
              <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-1 rounded truncate">
                {run.status}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Column 3: Templates / Presets */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0F172A] rounded-xl border border-slate-800 p-4">
        <h2 className="text-sm font-bold mb-4 text-slate-200">Templates / Presets</h2>
        <div className="flex flex-col gap-3 overflow-y-auto pr-2 pb-4">
          {templates.map(tpl => (
            <div key={tpl.id} className="border border-dashed border-slate-700 rounded-xl p-4 flex flex-col gap-2">
              <div className="text-sm font-semibold text-slate-300">{tpl.name}</div>
              <p className="text-xs text-slate-500">{tpl.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HermesStudioView;

