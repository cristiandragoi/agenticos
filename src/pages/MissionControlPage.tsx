// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useData } from '../store/dataStore';
import { JarvisOrb } from '../components/jarvis/JarvisOrb';
import { JarvisConversationPanel } from '../components/jarvis/JarvisConversationPanel';
import { deriveJarvisOrbState, JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import { apiFetch, apiUrl } from '../api/client';

function cleanError(message?: string | null) {
  if (!message) return 'No details available.';
  const firstLine = String(message).split('\n')[0];
  return firstLine.replace(/\s+at\s+.*/i, '').slice(0, 180);
}

/**
 * MissionControlPage — the /mission-control route (product Milestone 1).
 *
 * Jarvis IS the main focus of this page:
 *   - large organic reactive orb (the existing JarvisOrb, size 180, driven
 *     by real voice/playback/run/backend-health signals — no fake states),
 *   - the live conversation surface (JarvisConversationPanel) beside it:
 *     streaming transcript, Manual/Conversation modes, voice selector,
 *     compact status strip, command menu, delegated strip, and a
 *     COLLAPSIBLE diagnostics drawer holding all technical telemetry.
 *
 * Removed from the permanent view (per the Milestone 1 layout contract):
 *   - the metric card grid (Backend Health / Providers / Agents / Executions),
 *   - the Providers & Models / Registered Agents / Pending Approvals lists,
 *   - the Active Executions / Failed Runs list panels,
 *   - the Recent Completed / Teams / CodeX / Schedules metric row,
 *   - the Pipelines / System Registry panels.
 * None of that data is lost — it is served by the collapsible diagnostics
 * drawer inside the conversation panel. There is NO permanent Action Log
 * panel on this route (that panel exists only in JarvisStudio at /jarvis).
 */
const MissionControlPage: React.FC = () => {
  const { runs, isLoading, error, refresh } = useData();

  // ── Jarvis orb wiring ─────────────────────────────────────────────────────
  // Reuses the EXISTING JarvisOrb component and its real-signal contract
  // (same events + health probe as JarvisStudio). No fake states: every input
  // is a real window event, the truthful backend health probe, or live run data.
  const [playbackActive, setPlaybackActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [backendOffline, setBackendOffline] = useState(false);
  const [micState, setMicState] = useState('idle');

  // Real playback lifecycle: speaking only after confirmed playback start.
  useEffect(() => {
    const onPlaybackStarted = () => setPlaybackActive(true);
    const onPlaybackEnded = () => setPlaybackActive(false);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
    window.addEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackStarted, onPlaybackStarted);
      window.removeEventListener(JARVIS_ORB_EVENTS.playbackEnded, onPlaybackEnded);
    };
  }, []);

  // Real audio levels (mic while listening, playback while speaking).
  useEffect(() => {
    const onInput = (e: any) => setInputLevel(e.detail?.level ?? 0);
    const onOutput = (e: any) => setOutputLevel(e.detail?.level ?? 0);
    window.addEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
    window.addEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    return () => {
      window.removeEventListener(JARVIS_ORB_EVENTS.inputLevel, onInput);
      window.removeEventListener(JARVIS_ORB_EVENTS.outputLevel, onOutput);
    };
  }, []);

  // Voice capture state broadcast by the conversation pipeline.
  useEffect(() => {
    const onVoiceState = (e: any) => {
      const next = typeof e.detail === 'string' ? e.detail : 'idle';
      setMicState(next);
    };
    window.addEventListener(JARVIS_ORB_EVENTS.voiceState, onVoiceState);
    return () => window.removeEventListener(JARVIS_ORB_EVENTS.voiceState, onVoiceState);
  }, []);

  // Truthful backend health probe (same cadence + semantics as JarvisStudio).
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await apiFetch('/api/health/gateway');
        if (!res.ok) {
          if (!cancelled) setBackendOffline(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) setBackendOffline(data?.status === 'offline');
      } catch {
        if (!cancelled) setBackendOffline(true);
      }
    };
    checkHealth();
    const id = window.setInterval(checkHealth, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Runtime state derived from LIVE Jarvis run activity (never faked). Only
  // genuinely in-flight work maps to "thinking".
  const jarvisRuns = runs.filter((run: any) => run.agentId === 'agent-jarvis');
  const jarvisInFlight = jarvisRuns.some((run: any) =>
    ['running', 'queued', 'executing', 'waiting', 'waiting_for_approval', 'approval_required'].includes(run.status)
  );
  const runtimeState: any = jarvisInFlight ? 'thinking' : 'idle';

  const orbState = deriveJarvisOrbState({ micState, playbackActive, runtimeState, backendOffline });

  if (isLoading) return null;

  return (
    <div className="h-full overflow-auto bg-[#0a0f16] text-slate-100" data-testid="mission-control-cockpit">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold">Mission Control</h1>
            <p className="mt-1 text-sm text-slate-500">Talk to Jarvis — by voice or text. Everything else stays out of the way.</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Retry
          </button>
        </header>

        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4" data-testid="mission-error-card">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-200">
              <AlertTriangle size={16} /> Backend unavailable
            </div>
            <p className="mt-2 text-sm text-rose-100">{cleanError(error)}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={refresh} className="rounded border border-rose-400/50 px-3 py-1.5 text-xs text-rose-100">Retry</button>
              <button type="button" className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400">Open diagnostics</button>
            </div>
          </div>
        )}

        {/* ── JARVIS IS THE MAIN FOCUS ─────────────────────────────────────
            Large organic reactive orb + the full conversational surface in
            one hero section. All technical telemetry moved into the
            collapsible diagnostics drawer inside the panel. ── */}
        <section
          className="rounded-md border border-slate-800 bg-slate-950/60 p-5"
          data-testid="mission-jarvis-orb"
        >
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-3" style={{ width: 220 }}>
              <div style={{ width: 200, height: 236 }}>
                <JarvisOrb state={orbState} inputLevel={inputLevel} outputLevel={outputLevel} size={180} />
              </div>
              <div className="text-center">
                <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Jarvis</div>
                <div data-testid="mission-orb-state-label" className="mt-0.5 text-xs font-semibold text-slate-300">
                  {orbState.charAt(0).toUpperCase() + orbState.slice(1)}
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <JarvisConversationPanel backendOffline={backendOffline} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default MissionControlPage;
