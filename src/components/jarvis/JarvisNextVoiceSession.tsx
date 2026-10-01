import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Radio, AlertTriangle, Disc, Loader2 } from 'lucide-react';
import { jarvisLiveKitSession } from '../../lib/jarvisLiveKitSession';

export interface JarvisNextVoiceHandle {
  startSession(): Promise<boolean>;
  stopSession(): Promise<void>;
  readonly isConnected: boolean;
}

export interface JarvisNextVoiceProps {
  roomName?: string;
  onTranscript?: (text: string, isUser: boolean) => void;
  className?: string;
}

type SessionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const TAG = '[JARVIS_NEXT_UI]';

export const JarvisNextVoiceSession = forwardRef<JarvisNextVoiceHandle, JarvisNextVoiceProps>(
  function JarvisNextVoiceSession(
    { roomName = 'jarvis-next-main', onTranscript, className = '' },
    ref,
  ) {
    const [liveKitState, setLiveKitState] = useState(() => jarvisLiveKitSession.getState());
    const [bargeInCount, setBargeInCount] = useState(0);
    const [clickCount, setClickCount] = useState(0);

    useEffect(() => {
      return jarvisLiveKitSession.subscribe(() => {
        setLiveKitState(jarvisLiveKitSession.getState());
      });
    }, []);

    useEffect(() => {
      console.log(`${TAG} event=component_mounted roomName=${roomName}`);
      return () => {
        console.log(`${TAG} event=component_unmounted`);
        jarvisLiveKitSession.stopSession().catch(() => undefined);
      };
    }, [roomName]);

    const connectToVoice = useCallback(async (): Promise<boolean> => {
      console.log(`${TAG} [JARVIS_NEXT_BUTTON] PHYSICAL CLICK RECEIVED`);
      console.log(`${TAG} event=start_conversation_click currentState=${liveKitState.sessionState} connected=${jarvisLiveKitSession.isConnected}`);
      return await jarvisLiveKitSession.startSession(roomName);
    }, [roomName, liveKitState.sessionState]);

    const disconnectFromVoice = useCallback(async () => {
      console.log(`${TAG} event=disconnect_click`);
      await jarvisLiveKitSession.stopSession();
    }, []);

    const triggerManualBargeIn = useCallback(() => {
      const room = jarvisLiveKitSession.currentRoom;
      if (room?.state === 'connected') {
        try {
          const payload = new TextEncoder().encode(JSON.stringify({ type: 'barge_in' }));
          room.localParticipant.publishData(payload, { reliable: true });
          setBargeInCount((c) => c + 1);
          console.log(`${TAG} event=barge_in_sent`);
        } catch (err: any) {
          console.error(`[JARVIS_NEXT_UI_ERROR] stage=barge_in error=${err?.message}`, err);
        }
      }
    }, []);

    const handleStartClick = useCallback(() => {
      setClickCount((n) => n + 1);
      console.log(`${TAG} [JARVIS_NEXT_BUTTON] PHYSICAL CLICK RECEIVED — firing connectToVoice`);
      void connectToVoice();
    }, [connectToVoice]);

    const handleStopClick = useCallback(() => {
      console.log(`${TAG} event=stop_click`);
      void disconnectFromVoice();
    }, [disconnectFromVoice]);

    useImperativeHandle(ref, () => ({
      startSession: connectToVoice,
      stopSession: disconnectFromVoice,
      get isConnected() {
        return jarvisLiveKitSession.isConnected;
      },
    }), [connectToVoice, disconnectFromVoice]);

    const sessionState = liveKitState.sessionState;
    const isSpeaking = liveKitState.isSpeaking;
    const isListening = liveKitState.isListening;
    const errorMsg = liveKitState.errorMsg;
    const micTrackCount = liveKitState.micTrackCount;

    const buttonLabel =
      sessionState === 'connecting' ? 'Starting...'
      : sessionState === 'connected' ? 'Stop Conversation'
      : sessionState === 'error'     ? 'Retry Conversation'
      : `Start Conversation [clicks: ${clickCount}]`;

    const buttonDisabled = sessionState === 'connecting';

    return (
      <div className={`p-4 rounded-xl border border-emerald-500/30 bg-slate-900/90 text-slate-100 shadow-xl ${className}`}>
        {/* Header & Status */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${sessionState === 'connected' ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
            <span className="font-semibold text-sm tracking-wide text-slate-200">JarvisNext — Local Voice</span>
            <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              €0/mo
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${
                sessionState === 'connected' ? 'bg-emerald-400'
                : sessionState === 'connecting' ? 'bg-amber-400 animate-pulse'
                : sessionState === 'error' ? 'bg-rose-500'
                : 'bg-slate-600'
              }`} />
              <span className="text-slate-400 font-mono text-[11px]">
                {sessionState === 'connected' ? 'ONLINE'
                : sessionState === 'connecting' ? 'CONNECTING'
                : sessionState === 'error' ? 'ERROR'
                : 'OFFLINE'}
              </span>
            </div>

            <button
              onClick={sessionState === 'connected' ? handleStopClick : handleStartClick}
              disabled={buttonDisabled}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm
                ${sessionState === 'connected'
                  ? 'bg-rose-600/80 hover:bg-rose-600 text-white'
                  : sessionState === 'error'
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'}
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {sessionState === 'connecting'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : sessionState === 'connected'
                ? <MicOff className="w-3.5 h-3.5" />
                : <Mic className="w-3.5 h-3.5" />}
              {buttonLabel}
            </button>
          </div>
        </div>

        {/* Visible error */}
        {errorMsg && (
          <div className="mt-3 p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Status Grid */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2 rounded bg-slate-800/60 border border-slate-700/50">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Audio Ownership</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-300">JarvisNext Mic:</span>
              <span className={`font-semibold ${micTrackCount > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{micTrackCount}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-slate-300">Assistant Voice:</span>
              <span className="font-semibold text-emerald-400">{isSpeaking ? 'Active' : 'Idle'}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between text-slate-500">
              <span>Legacy Voice:</span>
              <span>0 (Disabled)</span>
            </div>
          </div>

          <div className="p-2 rounded bg-slate-800/60 border border-slate-700/50">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Local Infrastructure</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-300">LiveKit Server:</span>
              <span className="text-slate-200">localhost:7880</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-slate-300">Local STT / TTS:</span>
              <span className="text-emerald-400">Whisper / Neural</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-slate-300">Barge-Ins:</span>
              <span className="font-semibold text-amber-400">{bargeInCount}</span>
            </div>
          </div>
        </div>

        {/* Connected controls bar */}
        {sessionState === 'connected' && (
          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              {isSpeaking ? (
                <span className="flex items-center gap-1.5 text-sky-400">
                  <Volume2 className="w-4 h-4 animate-pulse" />
                  Jarvis Speaking...
                </span>
              ) : isListening ? (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <Disc className="w-4 h-4 animate-spin text-emerald-500" />
                  Listening...
                </span>
              ) : (
                <span className="text-slate-400">Connected</span>
              )}
            </div>

            <button
              onClick={triggerManualBargeIn}
              disabled={!isSpeaking}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-30 text-amber-300 rounded text-xs font-medium transition-colors flex items-center gap-1 border border-amber-500/30"
            >
              <VolumeX className="w-3.5 h-3.5" />
              Interrupt
            </button>
          </div>
        )}
      </div>
    );
  },
);
