import React, { memo } from 'react';
import type { JarvisNodeConfig, JarvisNodeId } from './JarvisTypes';
import { CHANNELS } from './JarvisState';

interface Props {
  nodes: JarvisNodeConfig[];
  activeNode?: JarvisNodeId | null;
  nodeActivity?: Partial<Record<JarvisNodeId, number>>;
  onNodeClick?: (node: JarvisNodeId, route?: string) => void;
}

export const JarvisSystemNodes = memo(function JarvisSystemNodes({
  nodes,
  activeNode,
  nodeActivity = {},
  onNodeClick,
}: Props) {
  return (
    <g className="jhv-system-nodes">
      {nodes.map((node) => {
        const activity = Math.max(0, Math.min(1, nodeActivity[node.id] ?? 0));
        const active = activeNode === node.id || activity > 0.05;
        const x = node.x * 10;
        const y = node.y * 10;
        const isLeft = node.side === 'left';
        const anchorX = isLeft ? 392 : 608;
        const anchorY = y < 500 ? Math.max(250, y + 15) : Math.min(690, y - 20);
        const color = node.id === 'Hermes' && active ? CHANNELS.pink : CHANNELS.cyan;

        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={node.label}
            className={`jhv-node ${active ? 'is-active' : ''}`}
            style={{ ['--node-activity' as any]: activity, color }}
            onClick={() => onNodeClick?.(node.id, node.route)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onNodeClick?.(node.id, node.route);
            }}
          >
            <path
              d={`M ${anchorX} ${anchorY} C ${(anchorX+x)/2} ${anchorY}, ${(anchorX+x)/2} ${y}, ${x} ${y}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={active ? 1.8 : 0.8}
              opacity={active ? 0.9 : 0.2}
              strokeDasharray="4 6"
            />
            <circle cx={x} cy={y} r={active ? 24 : 20} fill="#05111c" stroke="currentColor" strokeWidth={active ? 1.8 : 1}/>
            <circle cx={x} cy={y} r={active ? 8 : 5} fill="currentColor" opacity={active ? 0.9 : 0.45}/>
            <text x={x} y={y + 38} textAnchor="middle" className="jhv-node-label">{node.label}</text>
          </g>
        );
      })}
    </g>
  );
});
