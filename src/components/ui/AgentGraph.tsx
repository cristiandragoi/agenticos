import React, { useRef, useEffect, useState } from 'react';
import type { AgentDefinition } from '../../types';

interface GraphNode {
  id: string;
  label: string;
  status: string;
  color: string;
  avatar: string;
  runtime: string;
  x: number;
  y: number;
  children?: string[];
}

interface AgentGraphProps {
  agents: AgentDefinition[];
  centerAgentId?: string;
  onNodeClick?: (agentId: string) => void;
}

const AgentGraph: React.FC<AgentGraphProps> = ({ agents, centerAgentId = 'agent-jarvis-core', onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 });

  // Layout tree from center agent
  const buildGraph = (): GraphNode[] => {
    // Find center
    const center = agents.find(a => a.id === centerAgentId);
    if (!center) return [];

    // Cluster children into rings
    const active = agents.filter(a => a.id !== centerAgentId && a.status === 'active');
    const inactive = agents.filter(a => a.id !== centerAgentId && a.status === 'inactive');

    const centerNode: GraphNode = {
      ...center,
      label: center.name,
      runtime: center.runtimeId,
      x: dimensions.w / 2,
      y: 80,
      children: active.map(a => a.id),
    };

    const result: GraphNode[] = [centerNode];

    // Active agents in ring 2 (y=220), spread across width
    active.forEach((a, i) => {
      const angle = (i / active.length) * 2 * Math.PI - Math.PI / 2;
      const radius = Math.min(dimensions.w * 0.35, 280);
      result.push({
        ...a,
        label: a.name,
        runtime: a.runtimeId,
        x: dimensions.w / 2 + radius * Math.cos(angle),
        y: 220 + 40 * Math.sin(angle * 0.5),
        children: [],
      });
    });

    // Inactive agents in ring 3 (y=400)
    inactive.forEach((a, i) => {
      const cols = Math.min(inactive.length, 6);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const spacing = Math.min(dimensions.w / (cols + 1), 140);
      const offsetX = (dimensions.w - (cols - 1) * spacing) / 2;
      result.push({
        ...a,
        label: a.name,
        runtime: a.runtimeId,
        x: offsetX + col * spacing,
        y: 420 + row * 80,
        children: [],
      });
    });

    return result;
  };

  const nodes = buildGraph();

  // Draw connections from center to children
  const connections = nodes.flatMap(node =>
    (node.children || []).map(childId => {
      const child = nodes.find(n => n.id === childId);
      if (!child) return null;
      return { from: node, to: child };
    }).filter(Boolean)
  );

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
      style={{ background: 'transparent', minHeight: 500 }}
    >
      <defs>
        <filter id="glow-green">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-cyan">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connections */}
      {connections.map((conn: any, i) => {
        const isActive = conn.to.status === 'active';
        const midX = (conn.from.x + conn.to.x) / 2;
        const midY = (conn.from.y + conn.to.y) / 2 + 30;
        return (
          <path
            key={`conn-${i}`}
            d={`M${conn.from.x},${conn.from.y + 30} Q${midX},${midY} ${conn.to.x},${conn.to.y - 20}`}
            fill="none"
            stroke={isActive ? 'rgba(56, 189, 248, 0.25)' : 'rgba(107, 114, 128, 0.15)'}
            strokeWidth={1.5}
            strokeDasharray={isActive ? 'none' : '6 4'}
            style={{ transition: 'stroke-opacity 0.2s' }}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map(node => {
        const isCenter = node.id === centerAgentId;
        const isActive = node.status === 'active';
        const w = isCenter ? 160 : 130;
        const h = isCenter ? 50 : 42;
        const isHovered = hovered === node.id;

        return (
          <g
            key={node.id}
            transform={`translate(${node.x - w / 2}, ${node.y})`}
            style={{ cursor: isCenter ? 'default' : 'pointer' }}
            onMouseEnter={() => setHovered(node.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => !isCenter && onNodeClick?.(node.id)}
          >
            {/* Glow effect for active nodes */}
            {isActive && (
              <rect
                x={-3}
                y={-3}
                width={w + 6}
                height={h + 6}
                rx={8}
                ry={8}
                fill="none"
                stroke={isCenter ? '#38bdf8' : '#10b981'}
                strokeWidth={isHovered ? 2 : 1}
                opacity={isHovered ? 0.8 : 0.3}
                filter={isCenter ? 'url(#glow-cyan)' : isHovered ? 'url(#glow-green)' : undefined}
              />
            )}

            {/* Node body */}
            <rect
              x={0}
              y={0}
              width={w}
              height={h}
              rx={6}
              ry={6}
              fill={isCenter ? 'rgba(56, 189, 248, 0.08)' : 'rgba(17, 17, 22, 0.95)'}
              stroke={
                isCenter ? 'rgba(56, 189, 248, 0.4)' :
                isActive ? `${node.color}44` :
                'var(--border-subtle)'
              }
              strokeWidth={1.5}
              style={{ transition: 'all 0.15s' }}
            />

            {/* Avatar circle */}
            <circle
              cx={16}
              cy={h / 2}
              r={12}
              fill={isCenter ? 'rgba(56, 189, 248, 0.2)' : `${node.color}22`}
              stroke={node.color}
              strokeWidth={1}
            />
            <text
              x={16}
              y={h / 2 + 4}
              textAnchor="middle"
              fill={node.color}
              fontSize={10}
              fontWeight={700}
            >
              {node.avatar?.slice(0, 2) || '?'}
            </text>

            {/* Label */}
            <text
              x={32}
              y={h / 2 - 2}
              fill={isCenter ? '#38bdf8' : 'var(--text-primary)'}
              fontSize={isCenter ? 13 : 11}
              fontWeight={600}
            >
              {node.label.length > 14 ? node.label.slice(0, 12) + '…' : node.label}
            </text>

            {/* Status text */}
            <text
              x={32}
              y={h / 2 + 12}
              fill={isActive ? '#10b981' : '#6b7280'}
              fontSize={8}
              fontWeight={500}
              letterSpacing="0.5"
            >
              {isActive ? '● ACTIVE' : '○ SLEEPING'}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default AgentGraph;