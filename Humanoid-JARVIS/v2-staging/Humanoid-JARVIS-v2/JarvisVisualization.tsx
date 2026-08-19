import React, { useMemo } from 'react';
import type { JarvisVisualizationProps } from './JarvisTypes';
import { DEFAULT_NODES, stateColor } from './JarvisState';
import { useJarvisAnimation } from './useJarvisAnimation';
import { JarvisHumanoid } from './JarvisHumanoid';
import { JarvisSystemNodes } from './JarvisSystemNodes';
import './JarvisVisualization.css';

export default function JarvisVisualization({
  state,
  activeNode = null,
  activeAgent = null,
  severity = 'none',
  speakingLevel = 0,
  thinkingIntensity = 0,
  isConnected = true,
  nodeActivity = {},
  visibleNodes,
  onNodeClick,
  className = '',
}: JarvisVisualizationProps) {
  const animation = useJarvisAnimation(state, speakingLevel, thinkingIntensity);
  const color = stateColor(state, severity);

  const nodes = useMemo(
    () => visibleNodes?.length
      ? DEFAULT_NODES.filter(n => visibleNodes.includes(n.id))
      : DEFAULT_NODES,
    [visibleNodes]
  );

  const handleNodeClick = (node: any, route?: string) => {
    if (onNodeClick) return onNodeClick(node, route);
    if (route) window.location.hash = route.replace(/^#/, '');
  };

  return (
    <div
      className={`jhv-root ${className}`}
      data-jarvis-state={state}
      data-active-agent={activeAgent ?? ''}
      style={{ ['--jarvis-color' as any]: color }}
    >
      <svg
        className="jhv-svg"
        viewBox="0 0 1000 900"
        role="img"
        aria-label={`Jarvis ${state}`}
      >
        <defs>
          <radialGradient id="jhvBg" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor={color} stopOpacity="0.08"/>
            <stop offset="55%" stopColor={color} stopOpacity="0.025"/>
            <stop offset="100%" stopColor="#020914" stopOpacity="0"/>
          </radialGradient>
        </defs>

        <rect width="1000" height="900" fill="url(#jhvBg)" />

        {/* Single central Jarvis only */}
        <JarvisHumanoid
          state={state}
          severity={severity}
          speakingLevel={speakingLevel}
          thinkingIntensity={thinkingIntensity}
          subscribe={animation.subscribe}
        />

        {/* Functional orbital subsystem nodes */}
        <JarvisSystemNodes
          nodes={nodes}
          activeNode={activeNode}
          nodeActivity={nodeActivity}
          onNodeClick={handleNodeClick}
        />
      </svg>

      <div className="jhv-status">
        <span className={`jhv-dot ${isConnected ? 'online' : 'offline'}`} />
        <strong>{state.toUpperCase()}</strong>
        {activeAgent ? <span className="jhv-agent">→ {activeAgent}</span> : null}
      </div>
    </div>
  );
}
