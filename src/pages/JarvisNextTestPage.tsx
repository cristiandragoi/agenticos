/**
 * JarvisNextTestPage — STANDALONE isolated voice test.
 *
 * Zero imports from old Jarvis, JarvisRuntimeContext, useVoiceIO,
 * PersistentJarvisDock, JarvisConversationPanel, or JarvisStudio.
 *
 * Purpose: prove MICROPHONE → LIVEKIT → AGENT → STT → LLM → TTS → SPEAKER
 * with nothing else in the way.
 */
import React, { useState, useRef, useCallback } from 'react';
import { Room, RoomEvent, RemoteTrack, RemoteParticipant, DataPacket_Kind } from 'livekit-client';
import { apiUrl } from '../api/client';

type Stage =
  | 'IDLE'
  | 'STARTING'
  | 'TOKEN_REQUESTING'
  | 'TOKEN_OK'
  | 'ROOM_CONNECTING'
  | 'ROOM_CONNECTED'
  | 'MIC_REQUESTING'
  | 'MIC_ON'
  | 'AGENT_WAITING'
  | 'AGENT_READY'
  | 'RUNNING'
  | 'ERROR'
  | 'STOPPED';

interface LogEntry {
  ts: string;
  event: string;
  detail?: string;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

const JarvisNextTestPage: React.FC = () => {
  const [stage, setStage] = useState<Stage>('IDLE');
  const [clickCount, setClickCount] = useState(0);
  const [tokenStatus, setTokenStatus] = useState('—');
  const [livekitStatus, setLivekitStatus] = useState('—');
  const [micStatus, setMicStatus] = useState('—');
  const [agentStatus, setAgentStatus] = useState('—');
  const [micTrackSid, setMicTrackSid] = useState('—');
  const [agentIdentity, setAgentIdentity] = useState('—');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [assistantTexts, setAssistantTexts] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const addLog = useCallback((event: string, detail?: string) => {
    setLogs(prev => [...prev, { ts: ts(), event, detail }]);
  }, []);

  // ── START ──────────────────────────────────────────────────────────
  const startJarvisNext = useCallback(async () => {
    // SYNCHRONOUS — must happen before any await
    setClickCount(n => n + 1);
    setStage('STARTING');
    setErrorText(null);
    setTokenStatus('—');
    setLivekitStatus('—');
    setMicStatus('—');
    setAgentStatus('—');
    setMicTrackSid('—');
    setAgentIdentity('—');
    setTranscripts([]);
    setAssistantTexts([]);
    addLog('CLICK', 'START button pressed');

    // ── Token ────────────────────────────────────────────────────────
    setStage('TOKEN_REQUESTING');
    setTokenStatus('REQUESTING');
    addLog('TOKEN_REQUEST_START');
    let token: string;
    let wsUrl: string;
    try {
      const url = apiUrl('/api/jarvis-next/token');
      addLog('TOKEN_FETCH', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: 'jarvis-next-standalone-test',
          identity: `test-user-${Date.now().toString(36)}`,
          name: 'Test User',
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const json = await res.json();
      token = json.token;
      wsUrl = json.wsUrl;
      if (!token || !wsUrl) throw new Error(`Missing fields: ${JSON.stringify(json)}`);
      setTokenStatus('SUCCESS');
      setStage('TOKEN_OK');
      addLog('TOKEN_OK', `wsUrl=${wsUrl}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setTokenStatus(`FAILED: ${msg}`);
      setErrorText(`Token failed: ${msg}`);
      setStage('ERROR');
      addLog('ERROR', `token: ${msg}`);
      return;
    }

    // ── Room ─────────────────────────────────────────────────────────
    setStage('ROOM_CONNECTING');
    setLivekitStatus('CONNECTING');
    addLog('ROOM_CONNECT_START', wsUrl);
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    roomRef.current = room;

    // Attach remote audio tracks (agent TTS)
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _participant: RemoteParticipant) => {
      if (track.kind === 'audio' && audioRef.current) {
        track.attach(audioRef.current);
        addLog('TTS_STARTED', `track=${track.sid}`);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === 'audio' && audioRef.current) {
        track.detach(audioRef.current);
        addLog('TTS_FINISHED', `track=${track.sid}`);
      }
    });

    // Agent participant joins
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.identity !== room.localParticipant.identity) {
        setAgentStatus('READY');
        setAgentIdentity(participant.identity);
        setStage('RUNNING');
        addLog('AGENT_JOINED', participant.identity);
      }
    });

    // Data messages from agent (transcripts, assistant text)
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        if (data.type === 'transcript' || data.type === 'stt') {
          setTranscripts(prev => [...prev, data.text || text]);
          addLog('STT_TEXT', data.text || text);
        } else if (data.type === 'response' || data.type === 'assistant' || data.type === 'llm') {
          setAssistantTexts(prev => [...prev, data.text || text]);
          addLog('LLM_RESPONSE', data.text?.slice(0, 80) || text.slice(0, 80));
        } else {
          addLog('DATA_RECEIVED', `type=${data.type} from=${participant?.identity ?? 'unknown'}`);
        }
      } catch {
        addLog('DATA_RAW', new TextDecoder().decode(payload).slice(0, 100));
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      setLivekitStatus('DISCONNECTED');
      setMicStatus('OFF');
      setAgentStatus('—');
      setStage('STOPPED');
      addLog('ROOM_DISCONNECTED');
    });

    try {
      await room.connect(wsUrl!, token!);
      setLivekitStatus('CONNECTED');
      setStage('ROOM_CONNECTED');
      addLog('ROOM_CONNECTED', `name=${room.name} identity=${room.localParticipant.identity}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setLivekitStatus(`FAILED: ${msg}`);
      setErrorText(`LiveKit connect failed: ${msg}`);
      setStage('ERROR');
      addLog('ERROR', `room: ${msg}`);
      roomRef.current = null;
      return;
    }

    // ── Microphone ───────────────────────────────────────────────────
    setStage('MIC_REQUESTING');
    setMicStatus('REQUESTING');
    addLog('MIC_REQUEST_START');
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      const pubs = room.localParticipant.audioTrackPublications;
      const firstPub = pubs.values().next().value;
      const sid = firstPub?.trackSid ?? firstPub?.track?.sid ?? '(unknown)';
      setMicStatus('ON');
      setMicTrackSid(String(sid));
      setStage('MIC_ON');
      addLog('MIC_ON', `sid=${sid} count=${pubs.size}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setMicStatus(`FAILED: ${msg}`);
      setErrorText(`Microphone failed: ${msg}`);
      setStage('ERROR');
      addLog('ERROR', `mic: ${msg}`);
      await room.disconnect().catch(() => {});
      roomRef.current = null;
      return;
    }

    // ── Wait for agent ───────────────────────────────────────────────
    // Check if agent is already connected
    const remotes = Array.from(room.remoteParticipants.values());
    if (remotes.length > 0) {
      setAgentStatus('READY');
      setAgentIdentity(remotes[0].identity);
      setStage('RUNNING');
      addLog('AGENT_READY', remotes[0].identity);
    } else {
      setAgentStatus('WAITING');
      setStage('AGENT_WAITING');
      addLog('AGENT_WAITING', 'No remote participants yet');
    }
  }, [addLog]);

  // ── STOP ───────────────────────────────────────────────────────────
  const stopJarvisNext = useCallback(async () => {
    addLog('STOP', 'User pressed STOP');
    if (roomRef.current) {
      await roomRef.current.disconnect().catch(() => {});
      roomRef.current = null;
    }
    setStage('STOPPED');
    setLivekitStatus('DISCONNECTED');
    setMicStatus('OFF');
    setAgentStatus('—');
  }, [addLog]);

  const isRunning = stage !== 'IDLE' && stage !== 'STOPPED' && stage !== 'ERROR';

  // ── RENDER ─────────────────────────────────────────────────────────
  return (
    <div style={{
      background: '#0a0a0f', color: '#e2e8f0', minHeight: '100vh',
      padding: 32, fontFamily: "'JetBrains Mono', 'Consolas', monospace", fontSize: 13,
    }}>
      <audio ref={audioRef} autoPlay />

      <h1 style={{ color: '#22d3ee', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: 2 }}>
        JARVISNEXT STANDALONE TEST
      </h1>
      <p style={{ color: '#64748b', marginTop: 4, fontSize: 11 }}>
        Isolated from all old Jarvis code. Zero refs, zero old hooks, zero parent control.
      </p>

      {/* ── Big button ── */}
      <div style={{ marginTop: 20 }}>
        <button
          onClick={isRunning ? stopJarvisNext : startJarvisNext}
          disabled={stage === 'STARTING' || stage === 'TOKEN_REQUESTING' || stage === 'ROOM_CONNECTING' || stage === 'MIC_REQUESTING'}
          style={{
            padding: '14px 40px',
            fontSize: 16,
            fontWeight: 800,
            fontFamily: 'inherit',
            border: '3px solid',
            borderColor: isRunning ? '#ef4444' : '#22c55e',
            borderRadius: 8,
            background: isRunning ? '#7f1d1d' : '#14532d',
            color: 'white',
            cursor: 'pointer',
            letterSpacing: 2,
            opacity: (stage === 'STARTING' || stage === 'TOKEN_REQUESTING' || stage === 'ROOM_CONNECTING' || stage === 'MIC_REQUESTING') ? 0.5 : 1,
          }}
        >
          {stage === 'STARTING' || stage === 'TOKEN_REQUESTING' || stage === 'ROOM_CONNECTING' || stage === 'MIC_REQUESTING'
            ? 'STARTING...'
            : isRunning
            ? 'STOP JARVISNEXT'
            : 'START JARVISNEXT'}
        </button>
        <span style={{ marginLeft: 16, color: '#94a3b8', fontSize: 12 }}>
          CLICK COUNT: <strong style={{ color: '#fbbf24' }}>{clickCount}</strong>
        </span>
      </div>

      {/* ── Error ── */}
      {errorText && (
        <div style={{
          marginTop: 16, padding: 12, background: '#450a0a', border: '2px solid #ef4444',
          borderRadius: 6, color: '#fca5a5', fontSize: 12,
        }}>
          ERROR: {errorText}
        </div>
      )}

      {/* ── Status grid ── */}
      <div style={{
        marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 12, maxWidth: 700,
      }}>
        {([
          ['Stage', stage],
          ['Token', tokenStatus],
          ['LiveKit', livekitStatus],
          ['Microphone', micStatus],
          ['Mic Track SID', micTrackSid],
          ['Agent', agentStatus],
          ['Agent Identity', agentIdentity],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{
            padding: '6px 10px', background: '#1e293b', borderRadius: 4,
            border: '1px solid #334155',
          }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
            <div style={{
              fontSize: 13, fontWeight: 700, marginTop: 2,
              color: value.includes('FAILED') || value.includes('ERROR') ? '#ef4444'
                : value === 'SUCCESS' || value === 'CONNECTED' || value === 'ON' || value === 'READY' || value === 'RUNNING' ? '#22c55e'
                : value.includes('REQUESTING') || value.includes('CONNECTING') || value.includes('STARTING') || value.includes('WAITING') ? '#fbbf24'
                : '#94a3b8',
            }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Transcript ── */}
      <div style={{ marginTop: 24, maxWidth: 700 }}>
        <h3 style={{ color: '#22d3ee', fontSize: 12, letterSpacing: 2, margin: '0 0 6px' }}>TRANSCRIPT (User STT)</h3>
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
          padding: 10, minHeight: 40, fontSize: 12, color: '#cbd5e1',
        }}>
          {transcripts.length === 0 ? <span style={{ color: '#475569' }}>(waiting for speech...)</span> : transcripts.map((t, i) => <div key={i}>• {t}</div>)}
        </div>
      </div>

      <div style={{ marginTop: 12, maxWidth: 700 }}>
        <h3 style={{ color: '#a78bfa', fontSize: 12, letterSpacing: 2, margin: '0 0 6px' }}>ASSISTANT TEXT</h3>
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
          padding: 10, minHeight: 40, fontSize: 12, color: '#cbd5e1',
        }}>
          {assistantTexts.length === 0 ? <span style={{ color: '#475569' }}>(waiting for response...)</span> : assistantTexts.map((t, i) => <div key={i}>• {t}</div>)}
        </div>
      </div>

      {/* ── Event log ── */}
      <div style={{ marginTop: 24, maxWidth: 700 }}>
        <h3 style={{ color: '#fb923c', fontSize: 12, letterSpacing: 2, margin: '0 0 6px' }}>EVENT LOG</h3>
        <div style={{
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4,
          padding: 8, maxHeight: 250, overflow: 'auto', fontSize: 11,
        }}>
          {logs.length === 0 ? (
            <span style={{ color: '#475569' }}>(no events)</span>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ color: l.event.includes('ERROR') ? '#ef4444' : '#94a3b8', lineHeight: 1.6 }}>
                <span style={{ color: '#475569' }}>{l.ts}</span>{' '}
                <span style={{ color: '#22d3ee', fontWeight: 700 }}>{l.event}</span>
                {l.detail && <span style={{ color: '#64748b' }}> {l.detail}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default JarvisNextTestPage;
