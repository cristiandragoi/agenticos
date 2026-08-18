/**
 * VoiceTracePanel — live stage trace for the physical microphone acceptance
 * test, plus a manual 10-step acceptance checklist (PASS/FAIL + route,
 * persisted to localStorage).
 *
 * The trace shows exactly one line per pipeline stage and highlights the
 * FIRST failure so a human tester can see where the spoken loop broke.
 *
 * Layout-stability milestone: collapsed by default (§7) — the trace is
 * diagnostic and must never permanently consume vertical space. The header
 * carries the compact summary ("N/N stages ok" / first failure). The manual
 * acceptance checklist is its own collapsed sub-section (§8) so it never
 * controls page height.
 */
import { useEffect, useState } from 'react';
import {
  voiceTraceGet, voiceTraceSubscribe, voiceTraceSummary, voiceTraceFirstFailure,
  voiceTraceBegin, type TraceEntry,
} from '../../diagnostics/voiceTrace';

const STAGE_LABEL: Record<string, string> = {
  vad_triggered: 'VAD triggered',
  audio_captured: 'Audio captured',
  transcript: 'Transcription',
  auto_submit: 'Auto-submit',
  conversation: 'Conversation ID',
  intent_route: 'Intent / route',
  provider_model: 'Provider / model',
  response_started: 'Response stream',
  response_done: 'Stream complete',
  tts_request: 'TTS request',
  playback_started: 'Audio playback',
};

const MANUAL_STEPS = [
  '1. "Hello Jarvis."',
  '2. "My favorite color is teal. Remember that."',
  '3. "What color did I just tell you?"',
  '4. "What project are we currently working on?"',
  '5. "What happened in our last Berlin roofing search?"',
  '6. "Say that again."',
  '7. "Turn this into a task for Hermes."',
  '8. Simple unrelated question (e.g. "What is 2+2?")',
  '9. Start a fresh conversation',
  '10. Persistent memory in the new conversation',
];

function loadResults(): Record<number, { pass: boolean | null; route: string }> {
  try {
    return JSON.parse(localStorage.getItem('jarvis.manualAcceptance') || '{}');
  } catch {
    return {};
  }
}
function saveResults(r: Record<number, { pass: boolean | null; route: string }>) {
  try {
    localStorage.setItem('jarvis.manualAcceptance', JSON.stringify(r));
  } catch { /* storage unavailable */ }
}

export default function VoiceTracePanel() {
  const [trace, setTrace] = useState<TraceEntry[]>(voiceTraceGet());
  const [results, setResults] = useState<Record<number, { pass: boolean | null; route: string }>>(loadResults);
  const [expanded, setExpanded] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  useEffect(() => voiceTraceSubscribe(setTrace), []);

  const summary = voiceTraceSummary();
  const firstFail = voiceTraceFirstFailure();
  const lastRoute = trace.find((e) => e.stage === 'intent_route');

  const mark = (i: number, pass: boolean) => {
    const next = { ...results, [i]: { pass, route: lastRoute ? lastRoute.detail : '' } };
    setResults(next);
    saveResults(next);
  };
  const passed = Object.values(results).filter((r) => r.pass === true).length;

  // Compact header summary — visible collapsed AND expanded (§7).
  const headerSummary = summary.fail > 0
    ? `· ⚠ ${summary.ok}/${summary.total} stages ok — first failure: ${STAGE_LABEL[firstFail?.stage || ''] || firstFail?.stage}`
    : summary.total > 0
      ? `· ${summary.ok}/${summary.total} stages ok`
      : '';

  return (
    <div data-testid="voice-trace-panel" style={{ border: '1px solid #1e293b', borderRadius: 10, marginTop: 8, background: '#0b1220', fontSize: 12 }}>
      <div
        data-testid="voice-trace-toggle"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>VOICE TRACE {headerSummary}</span>
        <span>
          <button onClick={(e) => { e.stopPropagation(); voiceTraceBegin(); }} style={{ marginRight: 6, background: '#1e293b', color: '#cbd5e1', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>Clear</button>
          <span style={{ color: '#64748b' }}>{expanded ? '▾' : '▸'}</span>
        </span>
      </div>
      {expanded && (
        <>
          <div data-testid="voice-trace-stages" style={{ padding: '0 10px 8px', maxHeight: 180, overflowY: 'auto', borderBottom: '1px solid #1e293b' }}>
            {trace.length === 0 && <div style={{ color: '#475569', padding: '4px 0' }}>No stages yet — speak or send a message to begin.</div>}
            {trace.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', color: e.status === 'fail' ? '#f87171' : e.status === 'ok' ? '#86efac' : '#94a3b8' }}>
                <span style={{ width: 14 }}>{e.status === 'fail' ? '✗' : e.status === 'ok' ? '✓' : '•'}</span>
                <span style={{ width: 130, flexShrink: 0 }}>{STAGE_LABEL[e.stage] || e.stage}</span>
                <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.detail}</span>
              </div>
            ))}
          </div>
          {/* Manual acceptance — collapsible sub-section (§8). */}
          <div style={{ padding: 8 }}>
            <button
              data-testid="voice-trace-checklist-toggle"
              onClick={() => setChecklistOpen((v) => !v)}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 0', fontSize: 12 }}
            >
              <span>MANUAL ACCEPTANCE — {passed}/{MANUAL_STEPS.length} passed · route auto-filled from the last trace</span>
              <span style={{ color: '#64748b' }}>{checklistOpen ? '▾' : '▸'}</span>
            </button>
            {checklistOpen && (
              <div data-testid="voice-trace-checklist" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
                {MANUAL_STEPS.map((label, i) => {
                  const r = results[i];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                      <span style={{ width: 280, color: '#e2e8f0' }}>{label}</span>
                      <button onClick={() => mark(i, true)} style={{ background: r?.pass === true ? '#166534' : '#1e293b', color: r?.pass === true ? '#bbf7d0' : '#94a3b8', border: 'none', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' }}>PASS</button>
                      <button onClick={() => mark(i, false)} style={{ background: r?.pass === false ? '#7f1d1d' : '#1e293b', color: r?.pass === false ? '#fecaca' : '#94a3b8', border: 'none', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' }}>FAIL</button>
                      <span style={{ color: '#64748b', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r?.route || ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
