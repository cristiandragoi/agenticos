// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges, ConnectionLineType } from '@xyflow/react';
import type { NodeProps, NodeChange, EdgeChange, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StageLogEntry } from '../../command/jarvisPipeline';
import { useNavigate } from 'react-router-dom';

interface RunData { agentId: string; status: string; createdAt: string; }

export const ALL_AGENTS = [
  { id: 'agent-qwythos', name: 'Qwythos 9B', role: 'Default Orchestrator', color: '#a78bfa', avatarClass: 'qwythos' },
  { id: 'agent-jarvis-core', name: 'JARVIS', role: 'Orchestrator', color: '#06b6d4', avatarClass: 'jarvis' },
  { id: 'agent-architect', name: 'Architect', role: 'System Design', color: '#8b5cf6', avatarClass: 'architect' },
  { id: 'agent-scout', name: 'Scout', role: 'Research', color: '#f59e0b', avatarClass: 'scout' },
  { id: 'agent-closer', name: 'Closer', role: 'Sales', color: '#10b981', avatarClass: 'closer' },
  { id: 'agent-hype', name: 'Hype', role: 'Marketing', color: '#ec4899', avatarClass: 'hype' },
  { id: 'agent-forge', name: 'Forge', role: 'Development', color: '#f97316', avatarClass: 'siege' },
  { id: 'agent-reviewer', name: 'Reviewer', role: 'QA', color: '#8b5cf6', avatarClass: 'architect' },
  { id: 'agent-keeper', name: 'Keeper', role: 'Knowledge', color: '#06b6d4', avatarClass: 'jarvis' },
  { id: 'agent-ghost', name: 'Ghost', role: 'Security', color: '#64748b', avatarClass: 'ghost' },
  { id: 'agent-steel', name: 'Steel', role: 'DevOps', color: '#ef4444', avatarClass: 'steel' },
  { id: 'agent-creative', name: 'Creative', role: 'Design', color: '#ec4899', avatarClass: 'hype' },
  { id: 'agent-mechanic', name: 'Mechanic', role: 'Infra', color: '#84cc16', avatarClass: 'ghost' },
  { id: 'agent-siege', name: 'Siege', role: 'Testing', color: '#f97316', avatarClass: 'siege' },
  { id: 'agent-vision', name: 'Vision', role: 'Strategy', color: '#a78bfa', avatarClass: 'architect' },
];

export const AgentGrid = ({ runs }: { runs: RunData[] }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
    {ALL_AGENTS.map((agent) => {
      const isOnline = agent.name !== 'Ghost';
      const isActive = ['JARVIS', 'Architect'].includes(agent.name);
      return (
      <div key={agent.id} style={{
        background: isActive ? 'rgba(6,182,212,0.05)' : '#111827', 
        border: `1px solid ${isActive ? '#06b6d4' : '#1e293b'}`, 
        borderRadius: 8, padding: 16, width: 220, position: 'relative', 
        boxShadow: isActive ? '0 0 16px rgba(6,182,212,0.2)' : 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff',
              background: `linear-gradient(135deg, ${agent.color}, ${agent.color}aa)`,
            }}>{agent.name[0]}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: isActive ? '#06b6d4' : '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1 }}>{agent.name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? '#10b981' : '#64748b' }} />
            <span style={{ fontSize: 9, color: isOnline ? '#10b981' : '#64748b', fontWeight: 700, letterSpacing: 1 }}>{isOnline ? 'ACTIVE' : 'IDLE'}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#e2e8f0', marginBottom: 16, lineHeight: 1.4 }}>
          {isActive ? 'Starting agent fleet health check and polling' : agent.role}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
          <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.1)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#06b6d4', fontSize: 10 }}>◧</span>
          </div>
        </div>
      </div>
    )})}
  </div>
);

const AgentNode = ({ data }: NodeProps) => {
  const isOnline = data.name !== 'Ghost';
  const isActive = ['JARVIS', 'Architect'].includes(data.name as string);
  
  return (
    <div style={{
      background: '#111827',
      border: `1px solid ${isActive ? '#06b6d4' : '#1e293b'}`,
      borderRadius: 8,
      padding: '12px 16px',
      width: 200,
      boxShadow: isActive ? '0 0 16px rgba(6,182,212,0.2)' : '0 4px 6px rgba(0,0,0,0.3)',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#334155' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 20, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff',
            background: `linear-gradient(135deg, ${data.color as string}, ${data.color as string}aa)`,
          }}>{(data.name as string)[0]}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: isActive ? '#06b6d4' : '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1 }}>{data.name as string}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? '#10b981' : '#64748b' }} />
          <span style={{ fontSize: 9, color: isOnline ? '#10b981' : '#64748b', fontWeight: 700, letterSpacing: 1 }}>{isOnline ? 'ACTIVE' : 'IDLE'}</span>
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
        {data.role as string}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#334155' }} />
    </div>
  );
};

const nodeTypes = { agentNode: AgentNode };

const initialNodes: Node[] = [
  { id: 'jarvis', type: 'agentNode', position: { x: 400, y: 50 }, data: { name: 'JARVIS', role: 'Orchestrator', color: '#06b6d4' } },
  { id: 'architect', type: 'agentNode', position: { x: 150, y: 150 }, data: { name: 'Architect', role: 'System Design', color: '#8b5cf6' } },
  { id: 'scout', type: 'agentNode', position: { x: 400, y: 150 }, data: { name: 'Scout', role: 'Research', color: '#f59e0b' } },
  { id: 'forge', type: 'agentNode', position: { x: 650, y: 150 }, data: { name: 'Forge', role: 'Development', color: '#f97316' } },
  { id: 'vision', type: 'agentNode', position: { x: 0, y: 250 }, data: { name: 'Vision', role: 'Strategy', color: '#a78bfa' } },
  { id: 'hype', type: 'agentNode', position: { x: 220, y: 250 }, data: { name: 'Hype', role: 'Marketing', color: '#ec4899' } },
  { id: 'closer', type: 'agentNode', position: { x: 400, y: 250 }, data: { name: 'Closer', role: 'Sales', color: '#10b981' } },
  { id: 'keeper', type: 'agentNode', position: { x: 600, y: 250 }, data: { name: 'Keeper', role: 'Knowledge', color: '#06b6d4' } },
  { id: 'steel', type: 'agentNode', position: { x: 820, y: 250 }, data: { name: 'Steel', role: 'DevOps', color: '#ef4444' } },
];

const initialEdges: Edge[] = [
  { id: 'e-j-a', source: 'jarvis', target: 'architect', type: 'smoothstep', animated: true, style: { stroke: '#06b6d4' } },
  { id: 'e-j-s', source: 'jarvis', target: 'scout', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-j-f', source: 'jarvis', target: 'forge', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-a-v', source: 'architect', target: 'vision', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-a-h', source: 'architect', target: 'hype', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-s-c', source: 'scout', target: 'closer', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-f-k', source: 'forge', target: 'keeper', type: 'smoothstep', style: { stroke: '#334155' } },
  { id: 'e-f-st', source: 'forge', target: 'steel', type: 'smoothstep', style: { stroke: '#334155' } },
];

const NodeMapSVG = () => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  return (
    <div style={{ background: '#0a0e17', border: '1px solid #1e293b', borderRadius: 12, height: 500, position: 'relative', overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        minZoom={0.2}
      >
        <Background color="#1e293b" gap={16} />
        <Controls style={{ background: '#111827', border: '1px solid #1e293b', fill: '#e2e8f0', borderRadius: 4 }} showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export const OverviewTab = ({ runs }: { runs: RunData[] }) => {
  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '32px' }}>
      <div>
        <div style={{ fontSize: 10, color: '#06b6d4', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>OPERATIONS DASHBOARD</div>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5, marginBottom: 4 }}>Overview - Command center summary</h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 40, paddingBottom: 24, borderBottom: '1px solid #1e293b' }}>
        <div className="jarvis-radar-orb">
          <div className="jarvis-orb-core"></div>
        </div>
        
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: '#06b6d4', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>JARVIS - MISSION CONTROL</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: '#e2e8f0', letterSpacing: -1, marginBottom: 12 }}>Jarvis Mission Control</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 600, marginBottom: 24, lineHeight: 1.5 }}>Jarvis Mission Control: voice + command center for my Agentic OS.</p>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ border: '1px solid #06b6d4', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#06b6d4', fontWeight: 700, letterSpacing: 1 }}>SYSTEMS NOMINAL</div>
            <div style={{ border: '1px solid #1e293b', background: '#111827', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#e2e8f0', fontWeight: 700, letterSpacing: 1 }}>14 NODES</div>
            <div style={{ border: '1px solid #1e293b', background: '#111827', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#10b981', fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> ACTIVE
            </div>
            <div style={{ border: '1px solid #1e293b', background: '#111827', borderRadius: 4, padding: '4px 10px', fontSize: 10, color: '#f59e0b', fontWeight: 700, letterSpacing: 1 }}>12 RUNNING</div>
          </div>
        </div>
      </div>

      <AgentGrid runs={runs} />
    </div>
  );
};

export const ActivityTab = ({ logs }: { logs: StageLogEntry[] }) => (
  <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '32px' }}>
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#06b6d4', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>ACTIVITY</div>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5, marginBottom: 4 }}>Live command stream</h2>
      <p style={{ fontSize: 12, color: '#94a3b8' }}>Real-time execution log across the entire agent fleet.</p>
    </div>
    
    <div style={{ flex: 1, background: '#111827', border: '1px solid #1e293b', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0f1623', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(6,182,212,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#06b6d4', boxShadow: '0 0 8px rgba(6,182,212,0.5)' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>LIVE ACTIVITY FEED</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {logs.map((item) => {
          const timeStr = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const isError = item.status === 'failed';
          const isSuccess = item.status === 'completed';
          const isRunning = item.status === 'running';
          const iconColor = isError ? '#ef4444' : isSuccess ? '#06b6d4' : isRunning ? '#8b5cf6' : '#f59e0b';
          const agentName = item.stageId.includes('welders') ? 'Scout' : item.stageId.includes('copy') ? 'Closer' : 'Jarvis';

          return (
          <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '80px 140px 1fr', padding: '16px 20px', borderBottom: '1px solid rgba(30,41,59,0.5)', alignItems: 'center', gap: 16, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#151d2e'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: "'JetBrains Mono', monospace" }}>
              {timeStr}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 4, background: `rgba(6, 182, 212, 0.1)`, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                {agentName[0]}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: iconColor }}>{agentName}</span>
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{item.status === 'running' ? `Running ${item.stageId}...` : item.summary?.split('.')[0]}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.summary}</div>
            </div>
          </div>
        )})}
        {logs.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No recent activity.</div>
        )}
      </div>
      <div style={{ padding: '16px 20px', background: '#0a0e17', borderTop: '1px solid #1e293b' }}>
        <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>RECENT EVENTS</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', marginTop: 4, lineHeight: 1 }}>{logs.length}</div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Newest events highlighted for quick review</div>
      </div>
    </div>
  </div>
);

export const OrgMapTab = ({ runs }: { runs: RunData[] }) => (
  <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '32px' }}>
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#06b6d4', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>ORG MAP</div>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5, marginBottom: 4 }}>Agent topology and hierarchy</h2>
    </div>
    
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '2px', height: 'calc(100vh - 400px)' }}>
      <NodeMapSVG />
    </div>
    
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Node card view</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Operator-friendly card scan for the current fleet.</p>
      </div>
      <AgentGrid runs={runs} />
    </div>
  </div>
);

export const ConsoleTab = () => {
  const presenceLists = {
    active: ALL_AGENTS.filter(a => ['JARVIS', 'Architect', 'Scout', 'Closer', 'Forge', 'Keeper'].includes(a.name)),
    idle: ALL_AGENTS.filter(a => ['Hype'].includes(a.name)),
    state: ALL_AGENTS.filter(a => !['JARVIS', 'Architect', 'Scout', 'Closer', 'Forge', 'Keeper', 'Hype'].includes(a.name))
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '32px' }}>
      <div style={{ paddingBottom: 16 }}>
        <div style={{ fontSize: 10, color: '#06b6d4', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>PRESENCE</div>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5, marginBottom: 4 }}>Live presence board</h2>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>Heartbeat and reported state across the fleet.</p>
      </div>
      
      <div style={{ flex: 1, background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 24, padding: '16px', background: '#0a0e17', borderRadius: 8, border: '1px solid #1e293b' }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', letterSpacing: 1, textTransform: 'uppercase' }}>Presence Board</h3>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Live operational visibility by derived presence state.</p>
        </div>

        <div style={{ display: 'flex', gap: 24, height: '100%' }}>
          {/* Active Column */}
          <div style={{ flex: 1, background: '#0a0e17', borderRadius: 8, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                <span style={{ color: '#10b981' }}>⚡</span> Active
              </div>
              <div style={{ fontSize: 11, background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>{presenceLists.active.length}</div>
            </div>
            <div style={{ padding: '12px 16px', fontSize: 10, color: '#64748b', background: '#0f1623', borderBottom: '1px solid #1e293b', fontWeight: 600 }}>
              healthy heartbeat + active status
            </div>
            <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {presenceLists.active.map(a => (
                <div key={a.id} style={{ background: '#151d2e', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: `linear-gradient(135deg, ${a.color}, ${a.color}aa)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>{a.name[0]}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5 }}>{a.name}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{a.role.toLowerCase()}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Idle Column */}
          <div style={{ flex: 1, background: '#0a0e17', borderRadius: 8, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                <span style={{ color: '#f59e0b' }}>◐</span> Idle
              </div>
              <div style={{ fontSize: 11, background: '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>{presenceLists.idle.length}</div>
            </div>
            <div style={{ padding: '12px 16px', fontSize: 10, color: '#64748b', background: '#0f1623', borderBottom: '1px solid #1e293b', fontWeight: 600 }}>
              connected but not actively running
            </div>
            <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {presenceLists.idle.map(a => (
                <div key={a.id} style={{ background: '#151d2e', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: `linear-gradient(135deg, ${a.color}, ${a.color}aa)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>{a.name[0]}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5 }}>{a.name}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{a.role.toLowerCase()}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const MemoryTab = () => {
  const navigate = useNavigate();
  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '32px' }}>
      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 400 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(6,182,212,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <span style={{ fontSize: 24 }}>🧠</span>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>Memory Core</h3>
        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>Access the agent fleet's shared vector memory and knowledge graph.</p>
        <button 
          onClick={() => navigate('/memory')}
          style={{ background: '#06b6d4', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
        >
          Open Memory Board
        </button>
      </div>
    </div>
  );
};

export const AnalyticsTab = () => (
  <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '32px' }}>
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 400 }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <span style={{ fontSize: 24 }}>📊</span>
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>Analytics & Portal</h3>
      <p style={{ fontSize: 12, color: '#94a3b8' }}>Fleet metrics and content portal access coming soon.</p>
    </div>
  </div>
);
