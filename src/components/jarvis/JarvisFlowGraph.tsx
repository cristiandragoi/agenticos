import React from 'react';
import type { StageId, StageStatus } from './jarvisTypes';

/**
 * FlowGraphNode — a rectangular box with neon border, label, and status dot.
 */
interface FlowNode {
  id: string;
  x: number;
  y: number;
  label: string;
  subtitle: string;
  color: string;
  status?: StageStatus;
  stageId: StageId;
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

/* ─── Fixed layout for the flow graph ─── */
const FLOW_NODES: FlowNode[] = [
  { id: 'input', x: 40,  y: 120, label: 'Input / Commands', subtitle: 'Voice or text', color: '#38bdf8', stageId: 'input' },
  { id: 'scout', x: 240, y: 40,  label: 'Job Discovery', subtitle: 'SCOUT · Apify', color: '#10b981', stageId: 'job_discovery' },
  { id: 'researcher', x: 240, y: 200, label: 'Welders Researcher', subtitle: 'DE/NL market', color: '#8b5cf6', stageId: 'welders_researcher' },
  { id: 'email', x: 440, y: 40,  label: 'Email Copywriter', subtitle: 'Gemini templates', color: '#a78bfa', stageId: 'email_copywriter' },
  { id: 'sentinel', x: 440, y: 200, label: 'Sentinel / Logging', subtitle: 'Monitor + log', color: '#ef4444', stageId: 'sentinel' },
  { id: 'video', x: 640, y: 40,  label: 'Video Agent', subtitle: 'Render pipeline', color: '#22c55e', stageId: 'video_agent' },
  { id: 'review', x: 640, y: 200, label: 'Review / QA', subtitle: 'Code + content', color: '#f59e0b', stageId: 'review_qa' },
  { id: 'deploy', x: 840, y: 120, label: 'Deploy / Output', subtitle: 'Obsidian vault', color: '#06b6d4', stageId: 'deploy_output' },
  { id: 'voice_reply', x: 840, y: 220, label: 'Voice Reply', subtitle: 'Audio generation', color: '#ec4899', stageId: 'jarvis_voice_reply' },
  { id: 'qwythos', x: 400, y: 280, label: 'Qwythos 9B', subtitle: 'Local LLM · Ollama', color: '#a78bfa', stageId: 'qwythos' },
  { id: 'code_generation', x: 200, y: 290, label: 'Qwable Coder', subtitle: 'Local code generation', color: '#3b82f6', stageId: 'code_generation' },
  { id: 'preview_build', x: 600, y: 290, label: 'Build Preview', subtitle: 'Live preview generation', color: '#10b981', stageId: 'preview_build' },
  { id: 'save_workspace', x: 800, y: 290, label: 'Save Workspace', subtitle: 'Persist workspace assets', color: '#f59e0b', stageId: 'save_workspace' },
];

const FLOW_EDGES: FlowEdge[] = [
  { from: 'input', to: 'scout', label: 'discover' },
  { from: 'input', to: 'researcher', label: 'research' },
  { from: 'scout', to: 'email', label: 'leads→copy' },
  { from: 'researcher', to: 'email', label: 'intel' },
  { from: 'email', to: 'sentinel', label: 'templates→send' },
  { from: 'input', to: 'video', label: 'brief→render' },
  { from: 'video', to: 'review', label: 'review' },
  { from: 'sentinel', to: 'deploy', label: 'log' },
  { from: 'review', to: 'deploy', label: 'approved' },
  { from: 'deploy', to: 'voice_reply', label: 'announce' },
  { from: 'input', to: 'qwythos', label: 'local' },
  { from: 'input', to: 'code_generation', label: 'code' },
  { from: 'code_generation', to: 'preview_build', label: 'build' },
  { from: 'preview_build', to: 'save_workspace', label: 'save' },
  { from: 'save_workspace', to: 'deploy', label: 'persist' },
];

const NODE_W = 170;
const NODE_H = 80;

interface JarvisFlowGraphProps {
  onStageClick?: (stageId: StageId) => void;
  selectedStageId?: StageId | null;
  stageStatuses?: Partial<Record<StageId, StageStatus>>;
}

const JarvisFlowGraph: React.FC<JarvisFlowGraphProps> = ({ onStageClick, selectedStageId, stageStatuses = {} }) => {
  const CANVAS_W = 1020;
  const CANVAS_H = 390;

  const getNodeCenter = (id: string): { x: number; y: number } => {
    const n = FLOW_NODES.find((node) => node.id === id);
    if (!n) return { x: 0, y: 0 };
    return { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 };
  };

  const STATUS_COLORS: Record<StageStatus, string> = { idle: '#6b7280', running: '#f59e0b', completed: '#22c55e', failed: '#ef4444' };

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ display: 'block', background: 'transparent' }}>
      <defs>
        <filter id="node-glow"><feDropShadow dx={0} dy={0} stdDeviation={6} floodColor="currentColor" floodOpacity={0.2} /></filter>
        <marker id="arrowhead" markerWidth={8} markerHeight={6} refX={8} refY={3} orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.15)" />
        </marker>
      </defs>

      <pattern id="fgrid" width={30} height={30} patternUnits="userSpaceOnUse">
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth={1} />
      </pattern>
      <rect width={CANVAS_W} height={CANVAS_H} fill="url(#fgrid)" />

      {FLOW_EDGES.map((edge, i) => {
        const from = getNodeCenter(edge.from);
        const to = getNodeCenter(edge.to);
        const cx = (from.x + to.x) / 2;
        const cy = (from.y + to.y) / 2 - 14;
        const pathD = `M ${from.x} ${from.y} Q ${cx} ${from.y + (to.y - from.y) / 2 + 10} ${to.x} ${to.y}`;
        return (
          <g key={`edge-${i}`}>
            <path d={pathD} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} strokeDasharray="5 4" markerEnd="url(#arrowhead)" />
            {edge.label && <text x={cx} y={cy} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize={9} fontFamily="'Inter', sans-serif">{edge.label}</text>}
            <circle r={3} fill="rgba(56,189,248,0.4)"><animateMotion dur={`${3 + i}s`} repeatCount="indefinite" path={pathD} /></circle>
          </g>
        );
      })}

      {FLOW_NODES.map((node) => {
        const effectiveStatus = stageStatuses[node.stageId] || node.status || 'idle';
        const dotColor = STATUS_COLORS[effectiveStatus];
        const isSelected = selectedStageId === node.stageId;

        return (
          <g
            key={node.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onStageClick?.(node.stageId)}
            onMouseEnter={(e) => { const t = e.currentTarget.querySelector('rect.main-bg'); if (t) t.setAttribute('stroke-opacity', '1'); }}
            onMouseLeave={(e) => { const t = e.currentTarget.querySelector('rect.main-bg'); if (t) t.setAttribute('stroke-opacity', '0.95'); }}
          >
            {isSelected && (
              <rect x={node.x - 4} y={node.y - 4} width={NODE_W + 8} height={NODE_H + 8} rx={16} ry={16}
                fill="none" stroke={node.color} strokeWidth={2} opacity={0.6}>
                <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
              </rect>
            )}

            <rect x={node.x - 2} y={node.y - 2} width={NODE_W + 4} height={NODE_H + 4} rx={14} ry={14}
              fill="none" stroke={node.color} strokeWidth={1} opacity={0.3} filter="url(#node-glow)" />

            <rect className="main-bg" x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={12} ry={12}
              fill="#0f172a" stroke={node.color} strokeWidth={1.5} strokeOpacity={0.95} />

            <rect x={node.x + 2} y={node.y + 2} width={NODE_W - 4} height={3} rx={2} ry={2} fill={node.color} opacity={0.8} />

            <circle cx={node.x + 18} cy={node.y + 24} r={5} fill={dotColor}>
              {effectiveStatus === 'running' && <animate attributeName="r" values="5;7;5" dur="1s" repeatCount="indefinite" />}
            </circle>

            <text x={node.x + 30} y={node.y + 28} fill="#f9fafb" fontSize={13} fontWeight={700} fontFamily="'Inter', sans-serif">
              {node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label}
            </text>

            <text x={node.x + 30} y={node.y + 46} fill="#6b7280" fontSize={10} fontFamily="'Inter', sans-serif">
              {node.subtitle}
            </text>

            {effectiveStatus === 'running' && (
              <rect x={node.x + 10} y={node.y + NODE_H - 4} width={NODE_W - 20} height={2} rx={1} ry={1} fill={node.color} opacity={0.6}>
                <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1s" repeatCount="indefinite" />
              </rect>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default JarvisFlowGraph;
export { FLOW_NODES, FLOW_EDGES };
