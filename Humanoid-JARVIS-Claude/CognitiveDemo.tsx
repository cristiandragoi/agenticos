import React, { useEffect, useMemo, useRef, useState } from 'react';
import { JarvisStage } from './JarvisStage';
import { CognitiveController } from './CognitiveController';
import type { CognitiveMode } from './CognitiveState';

const MODES: CognitiveMode[] = [
  'idle', 'listening', 'thinking', 'researching', 'delegating',
  'speaking', 'completed', 'warning', 'error',
];
const SPAWNS = ['memory', 'project', 'knowledge', 'hermes', 'codex', 'artifact'] as const;

const btn = (on: boolean): React.CSSProperties => ({
  background: on ? 'rgba(56,189,248,.18)' : 'rgba(10,20,30,.8)',
  color: '#7dd3fc',
  border: '1px solid rgba(56,189,248,.35)',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  letterSpacing: 1,
  textTransform: 'uppercase',
  cursor: 'pointer',
});

/** Independent test harness — NOT AgenticOS. */
export const CognitiveDemo: React.FC = () => {
  const controller = useMemo(() => new CognitiveController(), []);
  const [mode, setMode] = useState<CognitiveMode>('idle');
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const setM = (m: CognitiveMode) => { setMode(m); controller.setMode(m); };

  const runSequence = () => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const mem = { id: '' }, her = { id: '' };
    at(0, () => setM('listening'));
    at(1200, () => setM('thinking'));
    at(2600, () => { mem.id = controller.spawn('memory') ?? ''; });
    at(5600, () => controller.resolve(mem.id));
    at(6800, () => { setM('delegating'); her.id = controller.spawn('hermes') ?? ''; });
    at(9600, () => controller.resolve(her.id));
    at(10800, () => setM('speaking'));
    at(12600, () => setM('completed'));
    at(14200, () => setM('idle'));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#020914', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: '18px 24px 26px', color: '#7dd3fc', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 15, letterSpacing: 3, color: '#00eaff', fontWeight: 700 }}>COGNITIVE FIELD — STANDALONE</h1>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(148,163,184,0.75)' }}>locked humanoid base · overlay canvas · not AgenticOS-integrated</p>
      </div>
      <JarvisStage controller={controller} mode={mode} height={620} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 760 }}>
        {MODES.map((m) => (
          <button key={m} onClick={() => setM(m)} style={btn(m === mode)}>{m}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 760 }}>
        {SPAWNS.map((k) => (
          <button key={k} style={btn(false)} onClick={() => controller.spawn(k)}>{k}</button>
        ))}
        <button style={btn(false)} onClick={() => controller.resolveAll()}>resolve all</button>
        <button style={btn(false)} onClick={runSequence}>▶ run demo sequence</button>
      </div>
    </div>
  );
};

export default CognitiveDemo;
