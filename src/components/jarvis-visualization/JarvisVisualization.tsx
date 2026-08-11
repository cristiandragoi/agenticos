/**
 * Jarvis Humanoid Visualization — Main Component
 * ============================================================
 * A production-quality, fully programmable humanoid visualization
 * for the AgenticOS runtime. No raster images. SVG + Canvas hybrid.
 *
 * Architecture:
 *   - SVG layers: HumanoidCore, NeuralNetwork, SystemNodes
 *   - Canvas layer: ParticleField (ambient neural dust)
 *   - Animation: useJarvisAnimator (single RAF, shared state ref)
 *
 * Public API (JarvisVisualizationProps):
 *   state            — current runtime state
 *   activeNode       — which system node is active
 *   activeAgent      — delegated agent name
 *   severity         — condition severity
 *   speakingLevel    — 0.0–1.0 speech intensity
 *   thinkingIntensity— 0.0–1.0 cognitive load
 *   isConnected      — backend connectivity
 *   nodeActivity     — per-node activity levels
 *   layerOverrides   — per-layer color/intensity overrides
 *   onNodeClick      — click handler for system nodes
 *   onCoreClick      — click handler for core
 *
 * Usage:
 *   <JarvisVisualization
 *     state="thinking"
 *     thinkingIntensity={0.8}
 *     isConnected={true}
 *     activeNode="Memory"
 *   />
 */

import React, { useMemo, useCallback } from 'react';
import type { JarvisVisualizationProps, JarvisState, SystemNode, VisualChannel } from './JarvisState';
import { useJarvisAnimator } from './useJarvisAnimator';
import HumanoidCore from './HumanoidCore';
import NeuralNetwork from './NeuralNetwork';
import SystemNodes from './SystemNodes';
import ParticleField from './ParticleField';

import './JarvisVisualization.css';

const DEFAULT_SIZE = 500;

const JarvisVisualization: React.FC<JarvisVisualizationProps> = ({
  state,
  activeNode = null,
  activeAgent = null,
  severity = 'none',
  speakingLevel = 0,
  thinkingIntensity = 0,
  isConnected = true,
  nodeActivity = {},
  layerOverrides,
  onNodeClick,
  onCoreClick,
  visibleNodes,
  className = '',
  width = DEFAULT_SIZE,
  height = DEFAULT_SIZE,
}) => {
  // ── Animation Engine ──
  const animator = useJarvisAnimator({
    state,
    activeNode,
    severity,
    speakingLevel,
    thinkingIntensity,
    isConnected,
    nodeActivity,
    layerOverrides,
  });

  const centerX = width / 2;
  const centerY = height / 2;

  // ── Derived color for CSS theming ──
  const themeColor = useMemo(() => {
    const ch = animator.current.activeChannel;
    const colors: Record<VisualChannel, string> = {
      cyan: '#00e5ff',
      purple: '#a855f7',
      yellow: '#fbbf24',
      pink: '#f472b6',
      red: '#ef4444',
    };
    return colors[ch];
  }, [animator.current.activeChannel]);

  // ── Status label ──
  const statusLabel = useMemo(() => {
    if (severity === 'critical' || severity === 'high') return 'CRITICAL';
    if (severity === 'medium' || severity === 'low') return 'WARNING';
    if (activeAgent) return `DELEGATING → ${activeAgent.toUpperCase()}`;
    if (activeNode) return `${state.toUpperCase()} :: ${activeNode.toUpperCase()}`;
    return state.toUpperCase();
  }, [state, activeNode, activeAgent, severity]);

  return (
    <div
      className={`jarvis-visualization ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        overflow: 'hidden',
        '--jarvis-theme-color': themeColor,
      } as React.CSSProperties}
    >
      {/* Background ambient glow */}
      <div
        className="jarvis-ambient-bg"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80%',
          height: '80%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${themeColor}08 0%, transparent 70%)`,
          pointerEvents: 'none',
          transition: 'background 0.5s ease',
        }}
      />

      {/* Canvas particle layer (bottom) */}
      <ParticleField
        animator={animator}
        width={width}
        height={height}
        centerX={centerX}
        centerY={centerY}
      />

      {/* SVG neural pathways layer */}
      <NeuralNetwork
        animator={animator}
        width={width}
        height={height}
        centerX={centerX}
        centerY={centerY}
      />

      {/* SVG humanoid core layer */}
      <div
        onClick={onCoreClick}
        style={{ cursor: onCoreClick ? 'pointer' : 'default', position: 'absolute', inset: 0 }}
      >
        <HumanoidCore
          animator={animator}
          width={width}
          height={height}
          centerX={centerX}
          centerY={centerY}
        />
      </div>

      {/* SVG system nodes layer (top) */}
      <SystemNodes
        animator={animator}
        width={width}
        height={height}
        centerX={centerX}
        centerY={centerY}
        activeNode={activeNode}
        visibleNodes={visibleNodes}
        onNodeClick={onNodeClick}
      />

      {/* Status HUD */}
      <div className="jarvis-hud">
        <div className="jarvis-hud-status">{statusLabel}</div>
        <div className="jarvis-hud-connection">
          <span
            className={`jarvis-hud-dot ${isConnected ? 'connected' : 'disconnected'}`}
          />
          {isConnected ? 'ONLINE' : 'OFFLINE'}
        </div>
        {activeAgent && (
          <div className="jarvis-hud-agent">AGENT: {activeAgent}</div>
        )}
      </div>
    </div>
  );
};

export default React.memo(JarvisVisualization);
