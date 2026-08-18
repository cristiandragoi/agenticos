import { forwardRef, useImperativeHandle, useState } from 'react';
import { API_BASE as BACKEND } from '../../api/client';

/**
 * GOLDEN-PATH DIAGNOSTIC PANEL (development-only, hidden by default).
 *
 * Isolates  typed/voice text → backend → provider gateway → SSE stream →
 * renderer with NO voice processing, intent routing, memory, delegation,
 * persistence, TTS, node state, or history refresh. The provider call is REAL
 * (configured gateway) via POST /api/jarvis/diag/stream. Nothing is faked.
 *
 * The panel records per-turn: submit → backend headers → first_token →
 * first visible char → done, all under ONE operationId (correlation ID).
 *
 * VOICE→GOLDEN CONTROL (dev-only): when "Voice turns → this panel" is
 * checked, the Jarvis voice auto-submit hook routes successfully transcribed
 * voice turns here instead of the full Jarvis route. That separates
 *   voice capture/transcription/auto-submit
 * from
 *   full Jarvis intent/context/TTS
 * so a voice failure can be attributed to one side or the other.
 */
export interface GoldenPathPanelHandle {
  runPrompt: (text: string) => void;
  isVoiceRoutingEnabled: () => boolean;
}

interface DiagEntry {
  operationId: string;
  prompt: string;
  answer: string;
  provider?: string;
  model?: string;
  error?: string;
  timings: { headers?: number; firstToken?: number; firstVisible?: number; done?: number };
}

export const GoldenPathPanel = forwardRef<GoldenPathPanelHandle, { onVoiceRoutingChange?: (enabled: boolean) => void }>(
  function GoldenPathPanel({ onVoiceRoutingChange }, ref) {
    const [open, setOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [busy, setBusy] = useState(false);
    const [voiceRouting, setVoiceRouting] = useState(false);
    const [entries, setEntries] = useState<DiagEntry[]>([]);
    const [, setTick] = useState(0);

    async function run(textOverride?: string) {
      const text = (textOverride ?? prompt).trim();
      if (!text || busy) return;
      const operationId = `jarvis-diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry: DiagEntry = { operationId, prompt: text, answer: '', timings: {} };
      const t0 = performance.now();
      setBusy(true);
      setEntries((es) => [entry, ...es]);
      if (!textOverride) setPrompt('');
      try {
        const res = await fetch(`${BACKEND}/jarvis/diag/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, operationId }),
        });
        entry.timings.headers = Math.round(performance.now() - t0);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('stream body missing');
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() || '';
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const raw = dataLine.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            let ev: any;
            try { ev = JSON.parse(raw); } catch { continue; }
            if (ev.marker === 'first_token') entry.timings.firstToken = Math.round(performance.now() - t0);
            if (typeof ev.delta === 'string') {
              if (!entry.timings.firstVisible) entry.timings.firstVisible = Math.round(performance.now() - t0);
              entry.answer += ev.delta;
              setTick((t) => t + 1); // live stream render
            }
            if (ev.provider) entry.provider = ev.provider;
            if (ev.model) entry.model = ev.model;
            if (ev.type === 'error' || ev.error) entry.error = String(ev.error || ev.reason || 'provider error');
            if (ev.type === 'done' || ev.event === 'done') entry.timings.done = Math.round(performance.now() - t0);
          }
        }
        if (!entry.timings.done) entry.timings.done = Math.round(performance.now() - t0);
      } catch (err: any) {
        entry.error = String(err?.message || err);
      } finally {
        setBusy(false);
        setTick((t) => t + 1);
      }
    }

    useImperativeHandle(ref, () => ({
      runPrompt: (text: string) => { setPrompt(text); void run(text); },
      isVoiceRoutingEnabled: () => voiceRouting,
    }));

    function toggleVoiceRouting() {
      const next = !voiceRouting;
      setVoiceRouting(next);
      onVoiceRoutingChange?.(next);
    }

    return (
      <div style={{ border: '1px solid #b45309', borderRadius: 8, padding: 8, marginBottom: 8, background: '#1c1917' }} data-testid="golden-path-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{ background: '#b45309', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
          >
            {open ? 'HIDE' : 'GOLDEN PATH DIAG'}
          </button>
          {open && (
            <>
              <input
                data-testid="golden-path-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
                placeholder="Golden-path prompt (no voice/memory/TTS)…"
                style={{ flex: 1, minWidth: 200, background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '4px 8px' }}
              />
              <button
                type="button"
                data-testid="golden-path-send"
                onClick={() => void run()}
                disabled={busy || !prompt.trim()}
                style={{ background: busy ? '#555' : '#166534', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: busy ? 'wait' : 'pointer' }}
              >
                {busy ? '…' : 'RUN'}
              </button>
              <label style={{ color: '#fbbf24', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="golden-path-voice-toggle"
                  checked={voiceRouting}
                  onChange={toggleVoiceRouting}
                />
                Voice turns → this panel
              </label>
            </>
          )}
        </div>
        {open && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
            {entries.length === 0 && <div style={{ color: '#78716c', fontSize: 12 }}>No runs yet. Type a prompt and press RUN.</div>}
            {entries.map((e) => (
              <div key={e.operationId} style={{ borderTop: '1px solid #44403c', paddingTop: 6 }}>
                <div style={{ fontSize: 11, color: '#a8a29e', fontFamily: 'monospace' }}>
                  {e.operationId} · headers={e.timings.headers ?? '—'}ms firstToken={e.timings.firstToken ?? '—'}ms
                  firstVisible={e.timings.firstVisible ?? '—'}ms done={e.timings.done ?? '—'}ms
                  {e.provider ? ` · ${e.provider}/${e.model || '?'}` : ''}
                </div>
                <div style={{ fontSize: 11, color: '#e7e5e4' }}>Q: {e.prompt}</div>
                <div style={{ color: e.error ? '#f87171' : '#86efac', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {e.error ? `ERR: ${e.error}` : (e.answer || '…')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);
