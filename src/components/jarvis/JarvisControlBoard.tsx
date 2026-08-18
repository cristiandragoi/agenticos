import React, { useEffect, useState, useRef } from 'react';
import { X, Volume2, Activity, Users, Zap, ChevronsRight, MessageCircle } from 'lucide-react';
import JarvisAgentGraph from './JarvisAgentGraph';
import { useChat, useJarvis, useDrawer } from '../../store/appStore';
import { apiFetch, apiUrl } from '../../api/client';

interface AgentData { id: string; name: string; color: string; description: string; status: string; }
interface RunData { agentId: string; status: string; createdAt: string; }

const JarvisControlBoard: React.FC = () => {
  const drawer = useDrawer();
  const chat = useChat();
  const jarvis = useJarvis();

  const [agents, setAgents] = useState<AgentData[]>([]);
  const [runs, setRuns] = useState<RunData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentData | null>(null);
  const [detailRuns, setDetailRuns] = useState<RunData[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch agents and runs
  const fetchData = async () => {
    try {
      const [agentsRes, runsRes] = await Promise.all([
        apiFetch('/api/agents'),
        apiFetch('/api/runs'),
      ]);
      if (agentsRes.ok) setAgents(await agentsRes.json());
      if (runsRes.ok) {
        const runsJson: RunData[] = await runsRes.json();
        setRuns(runsJson.slice(-200)); // last 200 for performance
      }
    } catch (e) {
      console.error('[JarvisBoard] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 10000); // poll every 10s
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Agent click handler
  const handleAgentClick = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    setSelectedAgent(agentId);
    setAgentDetail(agent);
    setDetailRuns(runs.filter((r) => r.agentId === agentId).slice(-10).reverse());
  };

  // Chat with agent
  const handleChatWithAgent = () => {
    if (!selectedAgent) return;
    // Set the universal chat target to this agent
    chat.setTarget(selectedAgent);
    // Close the detail panel
    setSelectedAgent(null);
    setAgentDetail(null);
    // The user can now type in the bottom input
  };

  // Stats
  const totalAgents = new Set(agents.map((a) => a.id)).size;
  const activeNow = runs.filter((r) => r.status === 'running').length;
  const uniqueActive = new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)).size;
  const runsToday = runs.filter((r) => r.createdAt > new Date(Date.now() - 86400000).toISOString()).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: 14 }}>
        Loading fleet data...
      </div>
    );
  }

  const API = 'http://localhost:4000';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      {/* ─── Header ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
        background: 'rgba(15,23,42,0.95)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
          }}>
            J
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f9fafb' }}>JARVIS Control Board</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>Fleet status — click any agent to inspect</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchData} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#9ca3af', borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
          }}>
            Refresh
          </button>
          <button onClick={() => drawer.close()} style={{
            background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4,
          }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ─── Stats Bar ─── */}
      <div style={{
        display: 'flex', gap: 12, padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { icon: <Users size={14} />, label: 'Fleet Size', value: totalAgents, color: '#38bdf8' },
          { icon: <Activity size={14} />, label: 'Active Now', value: uniqueActive, color: '#22c55e' },
          { icon: <Zap size={14} />, label: 'Runs Today', value: runsToday, color: '#f59e0b' },
          { icon: <ChevronsRight size={14} />, label: 'Running Tasks', value: activeNow, color: '#a78bfa' },
        ].map((stat, i) => (
          <div key={i} style={{
            flex: 1, minWidth: 100, padding: '8px 12px',
            background: 'rgba(30,41,59,0.6)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ color: stat.color }}>{stat.icon}</span>
              <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>{stat.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f9fafb' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* ─── Main Content: Graph + Detail Sidebar ─── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Agent Graph */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          <div style={{
            background: '#0a0f1e', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)',
            overflow: 'hidden', minHeight: 600,
          }}>
            <JarvisAgentGraph
              agentsData={agents}
              runsData={runs}
              onAgentClick={handleAgentClick}
            />
          </div>
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: '#374151' }}>
            Click any agent card to view details and recent runs
          </div>
        </div>

        {/* Detail Sidebar */}
        {agentDetail && (
          <div style={{
            width: 320, borderLeft: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'rgba(15,23,42,0.98)',
          }}>
            {/* Detail Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: agentDetail.color || '#6366f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: '#fff',
                }}>
                  {(agentDetail.name || '?')[0]}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f9fafb' }}>{agentDetail.name}</div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{agentDetail.id}</div>
                </div>
              </div>
              <button onClick={() => { setSelectedAgent(null); setAgentDetail(null); }}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            {/* Description */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
                {agentDetail.description || 'No description available.'}
              </div>
            </div>

            {/* Stats */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
                Status
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                  {agentDetail.status || 'active'}
                </div>
                <div style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
                  Runs: {detailRuns.length}
                </div>
              </div>
            </div>

            {/* Recent Runs */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
                Recent Runs
              </div>
              {detailRuns.length === 0 ? (
                <div style={{ fontSize: 12, color: '#374151', textAlign: 'center', marginTop: 20 }}>No runs recorded yet.</div>
              ) : (
                detailRuns.map((r, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', marginBottom: 4,
                    background: 'rgba(30,41,59,0.4)', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.03)',
                    fontSize: 11, color: '#9ca3af',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                        background: r.status === 'completed' ? '#22c55e' : r.status === 'running' ? '#f59e0b' : '#ef4444',
                        marginRight: 6,
                      }} />
                      <span style={{ flex: 1 }}>{r.status || '?'}</span>
                      <span style={{ color: '#6b7280' }}>{r.createdAt.slice(11, 16)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Chat Button */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={handleChatWithAgent} style={{
                width: '100%', padding: '10px 14px',
                background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
                border: 'none', borderRadius: 8, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <MessageCircle size={16} />
                Chat with {agentDetail.name}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default JarvisControlBoard;

