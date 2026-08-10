// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState } from 'react';
import { mockAgents, mockProviders, mockRuns, mockArtifacts } from '../mocks/data';
import { useDrawer } from '../store/appStore';
import BoardColumn from '../components/ui/BoardColumn';
import EntityCard from '../components/ui/EntityCard';
import AgentAvatar from '../components/ui/AgentAvatar';
import { AlertTriangle, HelpCircle, Cpu, Send, Loader2, X } from 'lucide-react';
import { apiFetch, apiUrl } from '../api/client';

/* ─── Tooltip Helper ─── */
const HelpTip: React.FC<{ text: string }> = ({ text }) => (
  <span className="flex-row gap-1" style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8, cursor: 'help' }}>
    <HelpCircle size={10} />
    <span>{text}</span>
  </span>
);

const MissionControl: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;
  const drawer = useDrawer();

  // Gemini Console State
  const [showGemini, setShowGemini] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [geminiResponse, setGeminiResponse] = useState('');
  const [geminiLoading, setGeminiLoading] = useState(false);

  const handleGeminiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!geminiPrompt.trim() || geminiLoading) return;
    setGeminiLoading(true);
    setGeminiResponse('');
    try {
      const res = await apiFetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: geminiModel, prompt: geminiPrompt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gemini API Error');
      setGeminiResponse(data.reply);
    } catch (err: any) {
      setGeminiResponse(`Error: ${err.message}`);
    } finally {
      setGeminiLoading(false);
    }
  };

  const activeAgents = mockAgents.filter(a => a.status === 'active');
  const runningTasks = mockRuns.filter(r => r.status === 'running');
  const waitingTasks = mockRuns.filter(r => r.status === 'waiting');
  
  // Create mock alerts from unhealthy providers and failed runs
  const alerts = [
    ...mockProviders.filter(p => p.status === 'error' || p.status === 'needs-auth').map(p => ({
      id: `alert-p-${p.id}`, type: 'provider', refId: p.id, title: p.name, desc: p.errorMessage || 'Requires attention', status: p.status
    })),
    ...mockRuns.filter(r => r.status === 'failed').map(r => ({
      id: `alert-r-${r.id}`, type: 'run', refId: r.id, title: `Run Failed: ${r.id.slice(0, 8)}`, desc: r.errorMessage || 'Task execution failed', status: 'error'
    }))
  ];

  const recentOutputs = mockArtifacts.slice(0, 3);

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_mission_control.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Mission Control</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Overview of agents, pipelines, runs, and system health.
          </p>
          <HelpTip text="Mission Control overview of agents, pipelines, runs." />
        </div>
      </div>

      <div className="board-layout">
        <BoardColumn title="Active Agents" count={activeAgents.length}>
          <HelpTip text="Agents currently online and ready to accept tasks" />
          {activeAgents.map(agent => (
            <EntityCard
              key={agent.id}
              title={agent.name}
              subtitle={agent.kind}
              status={agent.status}
              accent={agent.color}
              onClick={() => drawer.open('agent', agent.id)}
            >
              <AgentAvatar avatar={agent.avatar} color={agent.color} size="md" status={agent.status} />
            </EntityCard>
          ))}
        </BoardColumn>

        <BoardColumn title="Running Tasks" count={runningTasks.length}>
          <HelpTip text="Tasks and workflows currently in execution" />
          {runningTasks.map(run => {
            const agent = mockAgents.find(a => a.id === run.agentId);
            return (
              <EntityCard
                key={run.id}
                title={`Run ${run.id.slice(0, 8)}`}
                subtitle={agent?.name}
                preview={run.input}
                status={run.status}
                accent="var(--color-info)"
                onClick={() => drawer.open('run', run.id)}
                tags={[run.mode]}
              />
            );
          })}
        </BoardColumn>

        <BoardColumn title="Waiting for Input" count={waitingTasks.length}>
          <HelpTip text="Paused tasks awaiting user response or approval" />
          {waitingTasks.map(run => (
            <EntityCard
              key={run.id}
              title={`Run ${run.id.slice(0, 8)}`}
              preview={run.output || run.input}
              status={run.status}
              accent="var(--color-warning)"
              onClick={() => drawer.open('run', run.id)}
            />
          ))}
        </BoardColumn>

        <BoardColumn title="Alerts & Health" count={alerts.length}>
          <HelpTip text="Provider issues, failed runs, and system warnings" />
          {alerts.map(alert => (
            <EntityCard
              key={alert.id}
              title={alert.title}
              preview={alert.desc}
              status={alert.status}
              accent={alert.status === 'error' ? 'var(--color-error)' : 'var(--color-warning)'}
              onClick={() => drawer.open(alert.type as any, alert.refId)}
              meta={[{ icon: <AlertTriangle size={14} />, label: alert.status }]}
            />
          ))}
        </BoardColumn>

        <BoardColumn title="Recent Outputs" count={recentOutputs.length}>
          <HelpTip text="Latest artifacts and outputs from recent runs" />
          {recentOutputs.map(art => (
            <EntityCard
              key={art.id}
              title={art.title}
              subtitle={`v${art.version}`}
              preview={art.preview}
              status={art.status}
              onClick={() => drawer.open('artifact', art.id)}
              tags={[art.type]}
            />
          ))}
        </BoardColumn>

        <BoardColumn title="External Integrations" count={1}>
          <HelpTip text="Third-party API services and consoles" />
          <EntityCard
            title="Gemini Interactive API"
            subtitle="Google DeepMind"
            preview="First-class integration for Gemini models"
            status="active"
            accent="#4285F4"
            onClick={() => setShowGemini(true)}
            meta={[{ icon: <Cpu size={14} />, label: 'Ready' }]}
          />
        </BoardColumn>
      </div>

      {/* Gemini Console Modal */}
      {showGemini && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 600, background: 'var(--bg-card)', border: '1px solid #4285F4', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(66, 133, 244, 0.2)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(66, 133, 244, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Cpu size={20} color="#4285F4" />
                <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Gemini Console</span>
              </div>
              <button onClick={() => setShowGemini(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Model:</label>
                <select value={geminiModel} onChange={e => setGeminiModel(e.target.value)} className="form-input" style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem' }}>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="gemini-2.0-pro-exp">Gemini 2.0 Pro Experimental</option>
                </select>
              </div>

              <form onSubmit={handleGeminiSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <textarea
                  value={geminiPrompt}
                  onChange={e => setGeminiPrompt(e.target.value)}
                  placeholder="Ask Gemini anything..."
                  rows={4}
                  className="form-input"
                  style={{ width: '100%', resize: 'vertical', padding: 12, fontFamily: 'inherit', fontSize: '0.9rem' }}
                />
                <button type="submit" disabled={!geminiPrompt.trim() || geminiLoading} className="btn btn-primary" style={{ background: '#4285F4', color: '#fff', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 8, border: 'none' }}>
                  {geminiLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                  {geminiLoading ? 'Generating...' : 'Send Prompt'}
                </button>
              </form>

              {geminiResponse && (
                <div style={{ marginTop: 10, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>
                  {geminiResponse}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default MissionControl;

