import { detectControlIntent } from '../../lib/controlIntent';
import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, Mic, MicOff, ChevronRight, Volume2, Sparkles, MessageSquare, Activity } from 'lucide-react';
import { useJarvisRuntime } from '../../context/JarvisRuntimeContext';
import { JarvisChat } from './JarvisChat';
import { JarvisComposer } from './JarvisComposer';
import { JarvisActionInspector } from './JarvisActionInspector';

export const PersistentJarvisDock: React.FC = () => {
  const navigate = useNavigate();
  const [dockTab, setDockTab] = useState<'chat' | 'activity'>('chat');
  const {
    voice,
    stopOutput,
    stopSpeaking,
    cancelRequest,
    endConversation,
    lastVoiceRejection,
    clearVoiceRejection,
    beginOutput,
    voiceRef,
    micState,
    setMicState,
    runtimeStatus,
    setRuntimeStatus,
    activeConversationId,
    setActiveConversationId,
    conversationLanguage,
    setConversationLanguage,
    voiceInterimTranscript,
    composerText,
    handleComposerTextChange,
    handleStreamDelta,
    handleAssistantDone,
    flushSpeechBuffer,
    workspaceContext,
    setLatestActionRecord,
    activeChatRef,
    isDockCollapsed,
    setIsDockCollapsed,
    toggleDock,
  } = useJarvisRuntime();

  const chatRef = useRef<any>(null);

  useEffect(() => {
    activeChatRef.current = chatRef.current;
    return () => {
      if (activeChatRef.current === chatRef.current) {
        activeChatRef.current = null;
      }
    };
  });

  const orbColor = (() => {
    if (runtimeStatus.state === 'error') return '#ef4444'; // red
    if ((voice as any).isSpeaking || (voice as any).speaking) return '#10b981'; // green
    if (micState === 'listening') return '#00e5ff'; // turquoise
    if (runtimeStatus.state === 'executing' || runtimeStatus.state === 'streaming') return '#a855f7'; // purple
    if (runtimeStatus.state === 'delegating') return '#ec4899'; // pink
    return '#00e5ff'; // turquoise (staying/idle)
  })();

  const isSpeaking = (voice as any).isSpeaking || (voice as any).speaking || false;
  const isListening = micState === 'listening';

  return (
    <>
      {isDockCollapsed && (
        <div
          data-testid="persistent-jarvis-dock-collapsed"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900/95 border border-cyan-500/40 rounded-full p-2 pr-4 shadow-2xl backdrop-blur-md cursor-pointer hover:border-cyan-400 transition-all group"
          onClick={toggleDock}
          title="Click to expand Jarvis Conversational Layer"
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center relative shadow-lg"
            style={{ backgroundColor: `${orbColor}22`, border: `2px solid ${orbColor}` }}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full ${isSpeaking || isListening ? 'animate-ping' : ''}`}
              style={{ backgroundColor: orbColor }}
            />
            {isSpeaking && (
              <Volume2 size={12} className="absolute text-emerald-400 animate-pulse" />
            )}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-white">
              <span>JARVIS</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300">
                ACTIVE
              </span>
            </div>
            <span className="text-[10.5px] text-slate-400">
              {isSpeaking ? 'Speaking...' : isListening ? 'Listening...' : 'Click to open'}
            </span>
          </div>
          <ChevronRight size={14} className="text-slate-500 group-hover:text-white transition-colors ml-1" />
        </div>
      )}

      <aside
        data-testid="persistent-jarvis-dock"
        className="w-96 flex-shrink-0 flex flex-col h-full bg-[#0b0f14]/95 border-l border-slate-800/80 shadow-2xl z-30 backdrop-blur"
        style={{ display: isDockCollapsed ? 'none' : 'flex' }}
      >
      {/* Dock Header */}
      <div className="p-3 px-4 border-b border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center relative"
            style={{ backgroundColor: `${orbColor}33`, border: `1.5px solid ${orbColor}` }}
          >
            <div
              className={`w-2 h-2 rounded-full ${isSpeaking || isListening ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: orbColor }}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-wider text-white">JARVIS</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 font-mono">
                {workspaceContext.activeModule || 'WORKSPACE'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400">
              {isSpeaking ? 'Responding...' : isListening ? 'Listening to voice...' : 'Operational layer ready'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/jarvis')}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Open Fullscreen Studio"
            data-testid="jarvis-dock-fullscreen"
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={toggleDock}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Collapse Jarvis Dock"
            data-testid="jarvis-dock-collapse"
          >
            <Minimize2 size={13} />
          </button>
        </div>
      </div>

      {/* Dock View Tabs: Conversation vs Action Activity */}
      <div className="px-3 py-1.5 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDockTab('chat')}
            data-testid="jarvis-dock-tab-chat"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              dockTab === 'chat'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <MessageSquare size={12} />
            <span>Chat</span>
          </button>
          <button
            onClick={() => setDockTab('activity')}
            data-testid="jarvis-dock-tab-activity"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              dockTab === 'activity'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Activity size={12} />
            <span>Action Activity</span>
          </button>
        </div>
      </div>

      {/* Voice Interim Bar if available */}
      {voiceInterimTranscript && (
        <div className="p-2 px-3 bg-cyan-950/40 border-b border-cyan-800/40 text-[11px] text-cyan-300 flex items-center gap-2">
          <Sparkles size={12} className="text-cyan-400 animate-spin" />
          <span className="truncate">{voiceInterimTranscript}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/* Chat Transcript Area (hidden via display when activity tab is active so state survives) */}
        <div className="h-full w-full" style={{ display: dockTab === 'chat' ? 'block' : 'none' }}>
          <JarvisChat
            ref={chatRef}
            conversationId={activeConversationId}
            onConversationCreated={(id) => setActiveConversationId(id)}
            onLanguageChange={(lang) => setConversationLanguage(lang)}
            onStatusChange={(status) => {
              setRuntimeStatus(status);
              if (status.state === 'completed') flushSpeechBuffer(true);
            }}
            composerText={composerText}
            onComposerTextChange={handleComposerTextChange}
            onMicStateChange={setMicState}
            onStreamDelta={handleStreamDelta}
            onAssistantResponse={handleAssistantDone}
            onResponseSettled={() => voiceRef.current?.notifyResponseSettled?.()}
            onNavigate={(target) => navigate(target)}
            onActionRecord={(rec) => setLatestActionRecord(rec)}
            hideComposerMic
            hideComposer
            transcriptVariant="chat"
            workspaceContext={workspaceContext}
          />
        </div>

        {/* Action Activity & Inspector Area */}
        {dockTab === 'activity' && (
          <div className="h-full w-full overflow-hidden">
            <JarvisActionInspector />
          </div>
        )}
      </div>

      {/* Bottom Composer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/80">
        {lastVoiceRejection && (
          <div
            data-testid="voice-rejection-notice"
            className="voice-rejection-notice mb-2 p-2 rounded bg-amber-500/15 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between"
            role="alert"
          >
            <span className="truncate mr-2">
              <strong>Voice ignored ({lastVoiceRejection.category}):</strong> {lastVoiceRejection.reason}
            </span>
            <button
              onClick={clearVoiceRejection}
              className="px-1 text-amber-400 hover:text-amber-100 font-bold"
              aria-label="Dismiss rejection notice"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          {voice.isSpeaking ? (
            <button
              aria-label="Stop Jarvis output"
              className="px-2 py-1 text-xs bg-amber-900/50 hover:bg-amber-800/50 text-amber-200 rounded border border-amber-700/50"
              onClick={stopSpeaking}
            >
              Stop Audio
            </button>
          ) : (
            <button
              aria-label="Stop Jarvis output"
              className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 rounded"
              onClick={stopOutput}
            >
              Stop
            </button>
          )}
          {(runtimeStatus.state === 'thinking' || runtimeStatus.state === 'executing') && (
            <button
              aria-label="Cancel Jarvis request"
              className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-200 rounded border border-red-700/50"
              onClick={cancelRequest}
            >
              Cancel Request
            </button>
          )}
          <button
            aria-label="Toggle Jarvis microphone"
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700/50 ml-auto"
            onClick={() => {
              if (voice.conversationActive) {
                endConversation();
              } else {
                void voice.startConversation();
              }
            }}
          >
            {voice.conversationActive ? 'Mic off' : 'Mic on'}
          </button>
        </div>
        <JarvisComposer
          onSendMessage={(text, channel) => {
            const chat = chatRef.current || activeChatRef.current;
            if (chat) {
              if (detectControlIntent(text)) { stopOutput(); return; }
              const turnId = beginOutput();
              chat.sendMessage(text, channel, turnId);
            }
          }}
          onMicStateChange={setMicState}
          isProcessing={runtimeStatus.state === 'thinking' || runtimeStatus.state === 'executing'}
          composerText={composerText}
          onComposerTextChange={handleComposerTextChange}
          onCancelResponse={() => {
            cancelRequest();
          }}
          hideMic
        />
      </div>
    </aside>
    </>
  );
};
