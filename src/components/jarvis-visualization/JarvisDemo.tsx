/**
 * Jarvis programmatic visualization — DEMO HARNESS (dev only).
 * Interactive storyboard: cycles states, drives sliders, logs node clicks.
 *
 * ⚠ DEMO ONLY — this file uses fake timers/state cycling on purpose, to
 * preview the visualization. AgenticOS PRODUCTION must NOT use it as runtime
 * truth; the real page maps actual runtime state through the adapter
 * (jarvisVisualizationAdapter.ts). This component is exported for demo/dev
 * routes and manual visual review.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import JarvisVisualization from './JarvisVisualization';
import type { JarvisState, Severity, SystemNode } from './JarvisState';
import './JarvisDemo.css';

const ALL_STATES: JarvisState[] = [
  'idle', 'listening', 'transcribing', 'thinking', 'researching',
  'executing', 'delegating', 'speaking', 'completed', 'warning', 'error', 'interrupted',
];

export function JarvisDemo() {
  const [state, setState] = useState<JarvisState>('idle');
  const [severity, setSeverity] = useState<Severity>('none');
  const [thinkingIntensity, setThinkingIntensity] = useState(0.4);
  const [speakingLevel, setSpeakingLevel] = useState(0);
  const [isConnected, setIsConnected] = useState(true);
  const [activeNode, setActiveNode] = useState<SystemNode | null>(null);
  const [nodeActivity, setNodeActivity] = useState<Partial<Record<SystemNode, number>>>({});
  const [log, setLog] = useState<string[]>([]);
  const [autoPlay, setAutoPlay] = useState(false);
  const idxRef = useRef(0);

  useEffect(() => {
    if (!autoPlay) return;
    const id = window.setInterval(() => {
      const st = ALL_STATES[idxRef.current % ALL_STATES.length];
      idxRef.current += 1;
      setState(st);
      setSeverity(st === 'error' ? 'high' : st === 'warning' ? 'medium' : 'none');
      setLog((l) => [...l.slice(-7), `state → ${st}`]);
    }, 2200);
    return () => window.clearInterval(id);
  }, [autoPlay]);

  const push = useCallback((msg: string) => setLog((l) => [...l.slice(-7), msg]), []);

  return (
    <div className="jv-demo">
      <div className="jv-demo-stage">
        <JarvisVisualization
          state={state}
          severity={severity}
          thinkingIntensity={thinkingIntensity}
          speakingLevel={speakingLevel}
          isConnected={isConnected}
          activeNode={activeNode}
          activeAgent={state === 'delegating' ? 'Hermes' : null}
          nodeActivity={nodeActivity}
          width={520}
          height={520}
          onNodeClick={(node) => {
            setActiveNode(node);
            setNodeActivity((a) => ({ ...a, [node]: 1 }));
            push(`CLICK ${node} → routes to real AgenticOS destination`);
            window.setTimeout(() => setNodeActivity((a) => ({ ...a, [node]: 0 })), 2500);
          }}
          onCoreClick={() => push('CLICK core')}
        />
      </div>

      <div className="jv-demo-panel">
        <h3>Jarvis Visualization Demo</h3>
        <div className="jv-demo-row">
          <button onClick={() => setAutoPlay((a) => !a)}>{autoPlay ? '⏸ Stop cycle' : '▶ Auto cycle'}</button>
          <button onClick={() => { idxRef.current = 0; setState('idle'); setSeverity('none'); }}>Reset</button>
        </div>
        <div className="jv-demo-row">
          <span>state</span>
          <select value={state} onChange={(e) => setState(e.target.value as JarvisState)}>
            {ALL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span>severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {(['none', 'low', 'medium', 'high', 'critical'] as Severity[]).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="jv-demo-row">
          <span>thinking {thinkingIntensity.toFixed(1)}</span>
          <input type="range" min={0} max={1} step={0.05} value={thinkingIntensity} onChange={(e) => setThinkingIntensity(+e.target.value)} />
          <span>speaking {speakingLevel.toFixed(1)}</span>
          <input type="range" min={0} max={1} step={0.05} value={speakingLevel} onChange={(e) => setSpeakingLevel(+e.target.value)} />
        </div>
        <div className="jv-demo-row">
          <label><input type="checkbox" checked={isConnected} onChange={(e) => setIsConnected(e.target.checked)} /> connected</label>
          <span>activeNode: {activeNode ?? '—'}</span>
        </div>
        <div className="jv-demo-log">
          {log.map((m, i) => <div key={i}>{m}</div>)}
        </div>
        <p className="jv-demo-note">DEMO ONLY — fake timers/states for preview. Production maps real runtime state through the AgenticOS adapter.</p>
      </div>
    </div>
  );
}

export default JarvisDemo;
