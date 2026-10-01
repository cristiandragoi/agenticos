import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const mock = vi.hoisted(() => ({options: null as any, voice: {stopSpeaking: vi.fn(), armSpeech:vi.fn(), endConversation:vi.fn(), speakProgressive:vi.fn(), notifyMicOff:vi.fn(), setVoiceOverride:vi.fn()} }));
vi.mock('../hooks/useVoiceIO', () => ({useVoiceIO: (options:any) => {mock.options=options; return mock.voice;}}));
import {JarvisRuntimeProvider, useJarvisRuntime} from '../context/JarvisRuntimeContext';
const wrapper=({children}:any)=><MemoryRouter><JarvisRuntimeProvider>{children}</JarvisRuntimeProvider></MemoryRouter>;
describe('shared output lifecycle', () => {
 it('speaks streamed sentences once and rejects all late output after stop', async () => {
 const {result}=renderHook(()=>useJarvisRuntime(),{wrapper});
 let id=0; act(()=>{id=result.current.beginOutput();});
 mock.voice.speakProgressive.mockClear();
 act(()=>{ result.current.handleStreamDelta('Real mission state. ', 'typed',id); result.current.handleAssistantDone('Real mission state.','typed',id); });
 expect(mock.voice.speakProgressive).toHaveBeenCalledTimes(1);
 await act(async ()=>{result.current.handleStreamDelta('unfinished', 'typed',id); result.current.stopOutput();
   // The halt is genuinely asynchronous: JarvisRuntimeContext.canonicalVoice.stopSpeaking
   // awaits the LiveKit interruption BEFORE stopping legacy playback, and cancelRequest
   // fires it un-awaited. Flush that chain so the assertion tests the halt itself.
   for(let i=0;i<8;i++) await Promise.resolve();});
 expect(mock.voice.stopSpeaking).toHaveBeenCalled();
 expect(mock.voice.endConversation).not.toHaveBeenCalled();
 act(()=>{result.current.handleStreamDelta('late.', 'typed',id); result.current.handleAssistantDone('late.','typed',id); result.current.flushSpeechBuffer(true);});
 expect(mock.voice.speakProgressive).toHaveBeenCalledTimes(1);
 });
 it('plain stop cancels output without ending the active voice conversation', () => {
 const {result}=renderHook(()=>useJarvisRuntime(),{wrapper}); const cancelResponse=vi.fn();
 result.current.activeChatRef.current={cancelResponse} as any;
 act(()=>mock.options.onControlCommand({kind:'stop',matched:'stop'}));
 expect(cancelResponse).toHaveBeenCalled();
 expect(mock.voice.stopSpeaking).toHaveBeenCalled();
 expect(mock.voice.endConversation).not.toHaveBeenCalled();
 });
});
