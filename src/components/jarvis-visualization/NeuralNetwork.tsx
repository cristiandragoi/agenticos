/**
 * Jarvis Humanoid Visualization — Neural Pathways (SVG)
 * Animated connection lines between brain, chest, and system nodes.
 */

import React, { useRef, useEffect } from 'react';
import { getChannelColor } from './useJarvisAnimator';
import type { AnimatorState } from './useJarvisAnimator';
import { SYSTEM_NODE_CONFIG } from './JarvisState';
import type { SystemNode } from './JarvisState';

interface NeuralNetworkProps {
  animator: React.MutableRefObject<AnimatorState>;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const NeuralNetwork: React.FC<NeuralNetworkProps> = ({ animator, width, height, centerX, centerY }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const update = () => {
      const a = animator.current;
      const ch = a.activeChannel;
      const intensity = a.layerIntensities.neuralPathways;

      // Update all connection lines
      const lines = svg.querySelectorAll('.neural-line');
      lines.forEach((line, i) => {
        const el = line as SVGLineElement;
        const phase = (a.neuralPhase + i * 0.15) % 1;
        const dashOffset = -phase * 20;
        el.setAttribute('stroke-dashoffset', String(dashOffset));
        el.setAttribute('stroke', getChannelColor(ch, intensity * (0.3 + 0.4 * a.glowPhase)));
        el.setAttribute('stroke-width', String(0.5 + intensity * 1.2));
      });

      // Update traffic dots
      const dots = svg.querySelectorAll('.traffic-dot');
      dots.forEach((dot, i) => {
        const el = dot as SVGCircleElement;
        const phase = (a.time / 2000 + i * 0.2) % 1;
        const opacity = phase < 0.1 ? phase * 10 : phase > 0.9 ? (1 - phase) * 10 : 1;
        el.setAttribute('opacity', String(opacity * intensity));
        el.setAttribute('fill', getChannelColor(ch, 1));
      });

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [animator]);

  const scale = Math.min(width, height) / 500;
  const sx = centerX;
  const sy = centerY;

  // Connection points
  const brainPoint = { x: 0, y: -80 };
  const chestPoint = { x: 0, y: 50 };

  // Generate node connection endpoints
  const nodeConnections = (Object.entries(SYSTEM_NODE_CONFIG) as [SystemNode, typeof SYSTEM_NODE_CONFIG[SystemNode]][]).map(
    ([name, config]) => {
      const rad = (config.angle * Math.PI) / 180;
      return {
        name,
        x: Math.cos(rad) * config.distance,
        y: -80 + Math.sin(rad) * config.distance * 0.8,
      };
    }
  );

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter id="neural-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="blur" in2="SourceGraphic" operator="over" />
        </filter>
      </defs>

      <g transform={`translate(${sx}, ${sy}) scale(${scale})`}>
        {/* Brain → Chest spine connection */}
        <line
          className="neural-line"
          x1={brainPoint.x}
          y1={brainPoint.y + 10}
          x2={chestPoint.x}
          y2={chestPoint.y - 15}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 6"
          opacity="0.6"
        />

        {/* Brain → Node connections */}
        {nodeConnections.map((node) => (
          <g key={node.name}>
            <line
              className="neural-line"
              x1={brainPoint.x}
              y1={brainPoint.y}
              x2={node.x * 0.7}
              y2={node.y * 0.7}
              stroke="currentColor"
              strokeWidth="0.6"
              strokeDasharray="3 5"
              opacity="0.4"
            />
            {/* Traffic dot */}
            <circle
              className="traffic-dot"
              cx={brainPoint.x + (node.x * 0.7 - brainPoint.x) * 0.5}
              cy={brainPoint.y + (node.y * 0.7 - brainPoint.y) * 0.5}
              r="2"
              fill="currentColor"
              opacity="0.8"
            />
          </g>
        ))}

        {/* Chest → Node connections */}
        {nodeConnections.slice(0, 5).map((node) => (
          <line
            key={`chest-${node.name}`}
            className="neural-line"
            x1={chestPoint.x}
            y1={chestPoint.y}
            x2={node.x * 0.6}
            y2={node.y * 0.6 + 30}
            stroke="currentColor"
            strokeWidth="0.5"
            strokeDasharray="2 4"
            opacity="0.3"
          />
        ))}

        {/* Inter-node mesh (sparse) */}
        {nodeConnections.map((node, i) => {
          const next = nodeConnections[(i + 2) % nodeConnections.length];
          return (
            <line
              key={`mesh-${node.name}`}
              className="neural-line"
              x1={node.x * 0.85}
              y1={node.y * 0.85}
              x2={next.x * 0.85}
              y2={next.y * 0.85}
              stroke="currentColor"
              strokeWidth="0.3"
              strokeDasharray="2 8"
              opacity="0.2"
            />
          );
        })}
      </g>
    </svg>
  );
};

export default React.memo(NeuralNetwork);
