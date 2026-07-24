import React, { useState, useEffect, useMemo } from 'react';

/* ─── Types ─── */
interface AgentNode {
  id: string;
  name: string;
  color: string;
  status: 'idle' | 'running' | 'failed';
  runsToday: number;
  lastRunAt: string | null;
  x: number;
  y: number;
  description: string;
}

interface Edge {
  from: string;
  to: string;
  label?: string;
}

/* ─── Fixed Layout ─── */
const AGENTS: AgentNode[] = [
  { id: 'agent-jarvis-core', name: 'JARVIS', color: '#38bdf8', status: 'idle', runsToday: 0, lastRunAt: null, x: 400, y: 40, description: 'Orbital command — fleet telemetry & orchestration' },
  { id: 'agent-architect', name: 'ARCHITECT', color: '#7c3aed', status: 'idle', runsToday: 0, lastRunAt: null, x: 100, y: 160, description: 'System design & architecture' },
  { id: 'agent-forge', name: 'FORGE', color: '#f97316', status: 'idle', runsToday: 0, lastRunAt: null, x: 250, y: 160, description: 'High-output code generation' },
  { id: 'agent-closer', name: 'CLOSER', color: '#ec4899', status: 'idle', runsToday: 0, lastRunAt: null, x: 400, y: 160, description: 'Sales & deal closing' },
  { id: 'agent-scout', name: 'SCOUT', color: '#10b981', status: 'idle', runsToday: 0, lastRunAt: null, x: 550, y: 160, description: 'Market research & scouting' },
  { id: 'agent-hype', name: 'HYPE', color: '#f59e0b', status: 'idle', runsToday: 0, lastRunAt: null, x: 700, y: 160, description: 'Content & social hype' },
  { id: 'agent-keeper', name: 'KEEPER', color: '#06b6d4', status: 'idle', runsToday: 0, lastRunAt: null, x: 100, y: 290, description: 'Knowledge base guardian' },
  { id: 'agent-reviewer', name: 'REVIEWER', color: '#a855f7', status: 'idle', runsToday: 0, lastRunAt: null, x: 250, y: 290, description: 'Code & doc review' },
  { id: 'agent-creative', name: 'CREATIVE', color: '#f43f5e', status: 'idle', runsToday: 0, lastRunAt: null, x: 400, y: 290, description: 'Creative design & branding' },
  { id: 'agent-mechanic', name: 'MECHANIC', color: '#84cc16', status: 'idle', runsToday: 0, lastRunAt: null, x: 550, y: 290, description: 'Infrastructure & fixes' },
  { id: 'agent-spark', name: 'SPARK', color: '#fbbf24', status: 'idle', runsToday: 0, lastRunAt: null, x: 700, y: 290, description: 'Quick idea prototyping' },
  { id: 'agent-hermes', name: 'Hermes', color: '#6366f1', status: 'idle', runsToday: 0, lastRunAt: null, x: 100, y: 420, description: 'General assistant & chat' },
  { id: 'agent-jarvis', name: 'Jarvis', color: '#38bdf8', status: 'idle', runsToday: 0, lastRunAt: null, x: 250, y: 420, description: 'Voice-first assistant' },
  { id: 'agent-sentinel', name: 'Sentinel', color: '#ef4444', status: 'idle', runsToday: 0, lastRunAt: null, x: 550, y: 420, description: 'Monitoring & alerting' },
  { id: 'agent-video', name: 'VideoAgent', color: '#22c55e', status: 'idle', runsToday: 0, lastRunAt: null, x: 700, y: 420, description: 'Video generation pipeline' },
  { id: 'agent-gemini-welders-research', name: 'Welders Researcher', color: '#8b5cf6', status: 'idle', runsToday: 0, lastRunAt: null, x: 100, y: 550, description: 'DE/NL welders market research' },
  { id: 'agent-gemini-email-copy', name: 'Email Copywriter', color: '#a78bfa', status: 'idle', runsToday: 0, lastRunAt: null, x: 300, y: 550, description: 'Email template generation' },
  { id: 'agent-video-pipeline', name: 'Video Pipeline', color: '#059669', status: 'idle', runsToday: 0, lastRunAt: null, x: 500, y: 550, description: 'Automated video creation' },
  { id: 'agent-fusion', name: 'Fusion', color: '#ec4899', status: 'idle', runsToday: 0, lastRunAt: null, x: 700, y: 550, description: 'Creative AI fusion' },
  { id: 'agent-qwable', name: 'Qwable Coder', color: '#3b82f6', status: 'idle', runsToday: 0, lastRunAt: null, x: 400, y: 650, description: 'Local coding engine based on Qwen 3.6 27B.' },
];

const EDGES: Edge[] = [
  // Core center
  { from: 'agent-jarvis-core', to: 'agent-architect' },
  { from: 'agent-jarvis-core', to: 'agent-forge' },
  { from: 'agent-jarvis-core', to: 'agent-closer' },
  { from: 'agent-jarvis-core', to: 'agent-scout' },
  { from: 'agent-jarvis-core', to: 'agent-hype' },
  { from: 'agent-jarvis-core', to: 'agent-keeper' },
  { from: 'agent-jarvis-core', to: 'agent-reviewer' },
  { from: 'agent-jarvis-core', to: 'agent-creative' },
  { from: 'agent-jarvis-core', to: 'agent-mechanic' },
  { from: 'agent-jarvis-core', to: 'agent-spark' },
  // Secondary agents
  { from: 'agent-jarvis-core', to: 'agent-hermes' },
  { from: 'agent-jarvis-core', to: 'agent-jarvis' },
  { from: 'agent-jarvis-core', to: 'agent-sentinel' },
  { from: 'agent-jarvis-core', to: 'agent-video' },
  // Pipeline flows
  { from: 'agent-gemini-welders-research', to: 'agent-gemini-email-copy', label: 'leads→templates' },
  { from: 'agent-gemini-email-copy', to: 'agent-sentinel', label: 'templates→send' },
  { from: 'agent-video', to: 'agent-video-pipeline', label: 'render→publish' },
  // Cross connections
  { from: 'agent-scout', to: 'agent-gemini-welders-research', label: 'intel' },
  { from: 'agent-creative', to: 'agent-hype', label: 'assets' },
  { from: 'agent-forge', to: 'agent-reviewer', label: 'review' },
  { from: 'agent-mechanic', to: 'agent-sentinel', label: 'deploy' },
  { from: 'agent-jarvis-core', to: 'agent-qwable', label: 'local-code' },
];

/* ─── Props ─── */
interface JarvisAgentGraphProps {
  agentsData: any[];
  runsData: any[];
  onAgentClick: (agentId: string) => void;
}

const JarvisAgentGraph: React.FC<JarvisAgentGraphProps> = ({ agentsData, runsData, onAgentClick }) => {
  /* ─── Compute status and stats from real data ─── */
  const enriched = useMemo(() => {
    const now = Date.now();
    const dayAgo = new Date(now - 86400000).toISOString();

    return AGENTS.map((node) => {
      // Find the matching agent in the API data
      const apiAgent = agentsData.find((a: any) => a.id === node.id);
      const agentRuns = runsData.filter((r: any) => r.agentId === node.id);
      const recentRuns = agentRuns.filter((r: any) => r.createdAt > dayAgo);
      const lastRun = agentRuns.length > 0
        ? agentRuns.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0]
        : null;

      // Status: any running? → running. Any failed? → failed. Else idle.
      let status: 'idle' | 'running' | 'failed' = 'idle';
      if (agentRuns.some((r: any) => r.status === 'running')) status = 'running';
      else if (agentRuns.length > 0) {
        const lastStatus = lastRun?.status;
        if (lastStatus === 'failed' || lastStatus === 'error') status = 'failed';
      }

      return {
        ...node,
        status,
        runsToday: recentRuns.length,
        lastRunAt: lastRun ? lastRun.createdAt.slice(11, 16) : null,
        description: apiAgent?.description || node.description,
      };
    });
  }, [agentsData, runsData]);

  const CANVAS_W = 830;
  const CANVAS_H = 630;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ display: 'block' }}>
      <defs>
        <filter id="neon-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="card-glow">
          <feDropShadow dx={0} dy={0} stdDeviation={6} floodColor="var(--color-hermes)" floodOpacity={0.15} />
        </filter>
      </defs>

      {/* Background grid */}
      <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
      </pattern>
      <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

      {/* Edges */}
      {EDGES.map((edge, i) => {
        const from = enriched.find((n) => n.id === edge.from);
        const to = enriched.find((n) => n.id === edge.to);
        if (!from || !to) return null;
        return <AgentEdge key={`edge-${i}`} from={from} to={to} label={edge.label} />;
      })}

      {/* Nodes */}
      {enriched.map((node) => (
        <AgentCard key={node.id} node={node} onClick={() => onAgentClick(node.id)} />
      ))}
    </svg>
  );
};

/* ─── SVG Sub-Components ─── */

function AgentEdge({ from, to, label }: { from: AgentNode; to: AgentNode; label?: string }) {
  const x1 = from.x + 75;
  const y1 = from.y + 55;
  const x2 = to.x + 75;
  const y2 = to.y;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + 8;
  const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  return (
    <g>
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} strokeDasharray="4 3" />
      {label && (
        <text x={cx} y={cy - 4} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={9} fontFamily="Inter, sans-serif">
          {label}
        </text>
      )}
    </g>
  );
}

function AgentCard({ node, onClick }: { node: AgentNode; onClick: () => void }) {
  const statusColors: Record<string, string> = {
    idle: '#22c55e',
    running: '#f59e0b',
    failed: '#ef4444',
  };

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* Shadow rect */}
      <rect
        x={node.x} y={node.y} width={150} height={110} rx={12} ry={12}
        fill="#111827" stroke={node.color} strokeWidth={1}
        filter="url(#card-glow)"
        opacity={0.9}
      />
      {/* Top color strip */}
      <rect x={node.x + 2} y={node.y + 2} width={146} height={3} rx={2} ry={2}
        fill={node.color} opacity={0.7} />

      {/* Status dot */}
      <circle cx={node.x + 16} cy={node.y + 22} r={5}
        fill={statusColors[node.status] || '#6b7280'}
        filter="url(#neon-glow)"
      />

      {/* Agent name */}
      <text x={node.x + 28} y={node.y + 26}
        fill="#f9fafb" fontSize={13} fontWeight={700} fontFamily="Inter, sans-serif"
      >
        {node.name.length > 16 ? node.name.slice(0, 15) + '…' : node.name}
      </text>

      {/* Description */}
      <foreignObject x={node.x + 8} y={node.y + 36} width={134} height={32}>
        <div style={{
          fontSize: 10, color: '#9ca3af', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          fontFamily: 'Inter, sans-serif'
        }}>
          {node.description}
        </div>
      </foreignObject>

      {/* Stats row */}
      <line x1={node.x + 8} y1={node.y + 74} x2={node.x + 142} y2={node.y + 74}
        stroke="rgba(255,255,255,0.05)" strokeWidth={1} />

      <text x={node.x + 10} y={node.y + 90}
        fill={node.color} fontSize={16} fontWeight={700} fontFamily="Inter, sans-serif"
      >
        {node.runsToday}
      </text>
      <text x={node.x + 36} y={node.y + 90}
        fill="#6b7280" fontSize={9} fontFamily="Inter, sans-serif"
      >
        today
      </text>

      {node.lastRunAt && (
        <text x={node.x + 142} y={node.y + 90}
          textAnchor="end" fill="#6b7280" fontSize={9} fontFamily="Inter, sans-serif"
        >
          last {node.lastRunAt}
        </text>
      )}
    </g>
  );
}

export default JarvisAgentGraph;
