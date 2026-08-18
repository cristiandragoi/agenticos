import React, { useState } from 'react';
import { JarvisVisualizationV2 } from './JarvisVisualizationV2';
import { ALL_STATES_V2, STATE_LABELS, type JarvisStateV2, type Severity } from './JarvisStateV2';

/** STANDALONE visual-gate demo: ONE large Jarvis against the dark
 *  AgenticOS-like background. Manual state switcher only. NOT wired to
 *  AgenticOS runtime; no nodes/composer/insights — visual review only. */
export const JarvisV2Demo: React.FC = () => {
  const [state, setState] = useState<JarvisStateV2>('idle');
  const [severity, setSeverity] = useState<Severity>('none');
  const [speaking, setSpeaking] = useState(0.7);
  const [thinking, setThinking] = useState(0.8);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 50% 38%, rgba(0,234,255,0.05), #020914 70%)',
        color: '#b9f4ff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 24px 28px',
        boxSizing: 'border-box',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ width: 'min(100%, 720px)', textAlign: 'center', marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 15, letterSpacing: 3, color: '#00eaff', fontWeight: 700 }}>JARVIS V2 — STANDALONE VISUAL GATE</h1>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(148,163,184,0.75)' }}>ONE humanoid · state changes localized regions · not wired to AgenticOS yet</p>
      </div>

      <div style={{ width: 'min(100%, 740px)', maxHeight: 'min(84vh, 860px)', flex: 1, display: 'flex', alignItems: 'center' }}>
        <JarvisVisualizationV2
          state={state}
          severity={severity}
          speakingLevel={state === 'speaking' ? speaking : 0}
          thinkingIntensity={state === 'thinking' || state === 'researching' ? thinking : 0}
        />
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: 'min(100%, 720px)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {ALL_STATES_V2.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              style={{
                fontSize: 11, letterSpacing: 1, cursor: 'pointer', padding: '5px 10px',
                background: s === state ? 'rgba(0,234,255,0.25)' : 'rgba(0,234,255,0.07)',
                color: s === state ? '#eaffff' : '#9be8ff',
                border: s === state ? '1px solid rgba(0,234,255,0.7)' : '1px solid rgba(0,234,255,0.25)',
                borderRadius: 8,
              }}
            >
              {STATE_LABELS[s]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, color: 'rgba(148,163,184,0.9)' }}>
          <label>severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} style={{ marginLeft: 6, background: '#05111c', color: '#b9f4ff', border: '1px solid rgba(0,234,255,0.3)', borderRadius: 6, padding: '2px 6px' }}>
              {(['none', 'low', 'medium', 'high', 'critical'] as Severity[]).map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>speaking {speaking.toFixed(1)}
            <input type="range" min={0} max={1} step={0.05} value={speaking} onChange={(e) => setSpeaking(+e.target.value)} />
          </label>
          <label>thinking {thinking.toFixed(1)}
            <input type="range" min={0} max={1} step={0.05} value={thinking} onChange={(e) => setThinking(+e.target.value)} />
          </label>
        </div>
      </div>
    </div>
  );
};

export default JarvisV2Demo;
