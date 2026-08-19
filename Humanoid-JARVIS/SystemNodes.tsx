/**
 * Jarvis Humanoid Visualization — System Nodes (SVG)
 * Fully functional orbital nodes: Memory, Projects, Knowledge, Hermes, CodeX, etc.
 * Clickable, animated, with real-time activity visualization.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { AnimatorState, getChannelColor } from './useJarvisAnimator';
import { SYSTEM_NODE_CONFIG, SystemNode, VisualChannel } from './JarvisState';

interface SystemNodesProps {
  animator: React.MutableRefObject<AnimatorState>;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  activeNode: SystemNode | null;
  onNodeClick?: (node: SystemNode) => void;
}

const SystemNodes: React.FC<SystemNodesProps> = ({
  animator,
  width,
  height,
  centerX,
  centerY,
  activeNode,
  onNodeClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number>(0);
  const hoveredNodeRef = useRef<SystemNode | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const update = () => {
      const a = animator.current;
      const ch = a.activeChannel;
      const baseIntensity = a.layerIntensities.systemNodes;

      (Object.keys(SYSTEM_NODE_CONFIG) as SystemNode[]).forEach((nodeName) => {
        const pulse = a.nodePulses[nodeName];
        const isActive = activeNode === nodeName;
        const isHovered = hoveredNodeRef.current === nodeName;
        const intensity = isActive ? 1 : isHovered ? 0.8 : baseIntensity + pulse * 0.5;

        // Node group
        const nodeEl = svg.querySelector(`#node-${nodeName}`) as SVGGElement;
        if (nodeEl) {
          const mainCircle = nodeEl.querySelector('.node-main') as SVGCircleElement;
          const outerRing = nodeEl.querySelector('.node-outer') as SVGCircleElement;
          const iconText = nodeEl.querySelector('.node-icon') as SVGTextElement;
          const labelText = nodeEl.querySelector('.node-label') as SVGTextElement;
          const glowRing = nodeEl.querySelector('.node-glow') as SVGCircleElement;

          const nodeColor: VisualChannel = isActive ? 'pink' : ch;
          const glowOpacity = intensity * (0.4 + 0.6 * a.glowPhase);

          if (mainCircle) {
            mainCircle.setAttribute('stroke', getChannelColor(nodeColor, intensity));
            mainCircle.setAttribute('stroke-width', String(1 + intensity * 2.5));
            mainCircle.setAttribute('fill', getChannelColor(nodeColor, intensity * 0.12));
            mainCircle.setAttribute('r', String(14 + pulse * 5));
          }

          if (outerRing) {
            outerRing.setAttribute('stroke', getChannelColor(nodeColor, intensity * 0.4));
            outerRing.setAttribute('r', String(20 + pulse * 3));
            outerRing.setAttribute('stroke-dasharray', isActive ? '3 3' : '2 6');
            outerRing.setAttribute('stroke-width', String(0.4 + intensity * 0.8));
          }

          if (glowRing) {
            glowRing.setAttribute('fill', getChannelColor(nodeColor, glowOpacity * 0.08));
            glowRing.setAttribute('r', String(28 + pulse * 8));
          }

          if (iconText) {
            iconText.setAttribute('fill', getChannelColor(isActive ? 'pink' : ch, 0.8 + intensity * 0.2));
            iconText.setAttribute('font-size', String(10 + pulse * 3));
            iconText.setAttribute('font-weight', isActive ? '700' : '600');
          }

          if (labelText) {
            labelText.setAttribute('fill', getChannelColor(isActive ? 'pink' : ch, 0.6 + intensity * 0.4));
            labelText.setAttribute('font-size', String(8 + pulse * 1.5));
            labelText.setAttribute('font-weight', isActive ? '600' : '500');
          }
        }

        // Connection beam
        const beam = svg.querySelector(`#beam-${nodeName}`) as SVGLineElement;
        if (beam) {
          const beamIntensity = isActive ? 0.7 : pulse * 0.4;
          beam.setAttribute('stroke', getChannelColor(isActive ? 'pink' : ch, beamIntensity));
          beam.setAttribute('stroke-width', String(0.5 + pulse * 2.5));
          beam.setAttribute('stroke-dasharray', isActive ? '4 4' : '4 8');
        }

        // Data packet (animated dot traveling along beam)
        const packet = svg.querySelector(`#packet-${nodeName}`) as SVGCircleElement;
        if (packet) {
          const packetPhase = (a.time / 1500 + (SYSTEM_NODE_CONFIG[nodeName].angle / 360)) % 1;
          const rad = (SYSTEM_NODE_CONFIG[nodeName].angle * Math.PI) / 180;
          const dist = SYSTEM_NODE_CONFIG[nodeName].distance * 0.7;
          const px = Math.cos(rad) * dist * packetPhase;
          const py = -80 + Math.sin(rad) * dist * 0.8 * packetPhase;
          packet.setAttribute('cx', String(px));
          packet.setAttribute('cy', String(py));
          packet.setAttribute('opacity', String((isActive || pulse > 0.3) ? 0.9 : 0));
          packet.setAttribute('fill', getChannelColor(isActive ? 'pink' : ch, 1));
        }
      });

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [animator, activeNode]);

  const scale = Math.min(width, height) / 500;
  const sx = centerX;
  const sy = centerY;

  const handleMouseEnter = useCallback((node: SystemNode) => {
    hoveredNodeRef.current = node;
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredNodeRef.current = null;
  }, []);

  const handleClick = useCallback((node: SystemNode) => {
    onNodeClick?.(node);
  }, [onNodeClick]);

  const nodes = Object.entries(SYSTEM_NODE_CONFIG) as [SystemNode, typeof SYSTEM_NODE_CONFIG[SystemNode]][];

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <defs>
        <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="blur" in2="SourceGraphic" operator="over" />
        </filter>
      </defs>

      <g transform={`translate(${sx}, ${sy}) scale(${scale})`}>
        {nodes.map(([name, config]) => {
          const rad = (config.angle * Math.PI) / 180;
          const x = Math.cos(rad) * config.distance;
          const y = -80 + Math.sin(rad) * config.distance * 0.8;

          return (
            <g key={name}>
              {/* Connection beam from brain */}
              <line
                id={`beam-${name}`}
                x1={0}
                y1={-80}
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                opacity="0.3"
                strokeDasharray="4 8"
              />

              {/* Data packet traveling along beam */}
              <circle
                id={`packet-${name}`}
                cx={0}
                cy={-80}
                r="2.5"
                fill="currentColor"
                opacity="0"
              />

              {/* Node group — interactive */}
              <g
                id={`node-${name}`}
                transform={`translate(${x}, ${y})`}
                style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                onMouseEnter={() => handleMouseEnter(name)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(name)}
              >
                {/* Glow ring */}
                <circle
                  className="node-glow"
                  cx="0"
                  cy="0"
                  r="28"
                  fill="currentColor"
                  opacity="0.05"
                  pointerEvents="none"
                />

                {/* Outer rotating ring */}
                <circle
                  className="node-outer"
                  cx="0"
                  cy="0"
                  r="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.4"
                  opacity="0.4"
                  strokeDasharray="2 6"
                  pointerEvents="none"
                />

                {/* Main node circle */}
                <circle
                  className="node-main"
                  cx="0"
                  cy="0"
                  r="14"
                  fill="rgba(0,0,0,0.3)"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.8"
                />

                {/* Icon / Initial */}
                <text
                  className="node-icon"
                  x="0"
                  y="1"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="currentColor"
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="var(--kimi-font-mono, monospace)"
                  opacity="0.9"
                  pointerEvents="none"
                >
                  {config.icon}
                </text>

                {/* Label */}
                <text
                  className="node-label"
                  x="0"
                  y="28"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="currentColor"
                  fontSize="8"
                  fontWeight="500"
                  fontFamily="var(--kimi-font-sans, sans-serif)"
                  opacity="0.7"
                  pointerEvents="none"
                >
                  {config.label}
                </text>

                {/* Side indicator (subtle L/R badge) */}
                <text
                  x={config.side === 'left' ? -22 : 22}
                  y="0"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="currentColor"
                  fontSize="6"
                  fontWeight="400"
                  opacity="0.25"
                  pointerEvents="none"
                >
                  {config.side === 'left' ? '◀' : '▶'}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
};

export default React.memo(SystemNodes);
