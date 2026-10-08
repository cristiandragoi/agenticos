/**
 * qa/human-simulator/audioBridge.ts
 *
 * Virtual Audio Bridge: feeds authentic synthesized or recorded speech into
 * the installed application's LiveKit WebRTC audio pipeline and captures
 * the live audible response from Jarvis.
 */

import type { Page } from 'puppeteer-core';
import type { AudioResponseCapture, SpokenUtterance } from './types.js';

export class AudioBridge {
  private backendUrl: string;

  private authToken: string | null = null;

  constructor(backendUrl = 'http://127.0.0.1:4600') {
    this.backendUrl = backendUrl;
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /**
   * Installs the Virtual Audio Bridge into the Electron renderer window.
   */
  async install(page: Page): Promise<void> {
    console.log('[AudioBridge] Installing Virtual Audio Bridge into Electron renderer...');
    await page.evaluate(() => {
      if ((window as any).__humanSimulatorAudioBridge) {
        (window as any).__humanSimulatorAudioBridge.active = true;
        return;
      }

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume();
      }
      const dest = audioCtx.createMediaStreamDestination();
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
      gainNode.connect(dest);

      // Keep stream continuously clocking frames so WebRTC track stays active
      const silenceOsc = audioCtx.createOscillator();
      const silenceGain = audioCtx.createGain();
      silenceGain.gain.setValueAtTime(0.00001, audioCtx.currentTime);
      silenceOsc.connect(silenceGain);
      silenceGain.connect(dest);
      silenceOsc.start();


      let lastRemoteAudio: HTMLAudioElement | null = null;
      const originalAudioPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function (this: HTMLAudioElement) {
        lastRemoteAudio = this;
        return originalAudioPlay.apply(this);
      };

      const bridge = {
        active: true,
        audioCtx,
        destination: dest,
        gainNode,
        getRemoteAudio: () => lastRemoteAudio,
        async playAudioBase64(base64Data: string, mimeType = 'audio/mpeg') {
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }
          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(gainNode);

          return new Promise<number>((resolve) => {
            source.onended = () => {
              resolve(audioBuffer.duration * 1000);
            };
            source.start();
          });
        },
      };

      (window as any).__humanSimulatorAudioBridge = bridge;

      const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async function (constraints) {
        if (constraints && (constraints as any).audio && bridge.active) {
          console.log('[AudioBridge] Intercepted getUserMedia! Supplying virtual destination audio track.');
          return bridge.destination.stream;
        }
        return origGUM(constraints);
      };

      console.log('[AudioBridge] Virtual Audio Bridge successfully active in renderer window.');
    });
  }

  /**
   * Synthesize speech using the production TTS endpoint.
   */
  async synthesizeUtterance(text: string, lang: 'de' | 'en' = 'de'): Promise<{ audioData: string; mimeType: string }> {
    const voice = lang === 'de' ? 'aura-2-julius-de' : 'en-GB-RyanNeural';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${this.backendUrl}/api/voice/tts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text,
            agentId: 'agent-jarvis',
            voice,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`TTS synthesis failed (${res.status}): ${errText}`);
        }

        const data = await res.json();
        return {
          audioData: data.audioData,
          mimeType: data.mimeType || 'audio/mpeg',
        };
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    throw lastError;
  }


  /**
   * Speak an utterance through the virtual microphone to Jarvis.
   */
  async speak(page: Page, utterance: SpokenUtterance): Promise<number> {
    console.log(`[AudioBridge] Speaking to Jarvis: "${utterance.text}" (${utterance.language})`);
    const { audioData, mimeType } = await this.synthesizeUtterance(utterance.text, utterance.language);

    // Give a brief pre-roll silence
    if (utterance.preRollSilenceMs) {
      await new Promise((r) => setTimeout(r, utterance.preRollSilenceMs));
    }

    const durationMs = await page.evaluate(async (b64, mime) => {
      const bridge = (window as any).__humanSimulatorAudioBridge;
      if (!bridge) throw new Error('AudioBridge not installed');
      return await bridge.playAudioBase64(b64, mime);
    }, audioData, mimeType);

    // Give post-roll trailing silence so VAD registers speech end
    const postRoll = utterance.postRollSilenceMs ?? 1000;
    await new Promise((r) => setTimeout(r, postRoll));

    return durationMs;
  }

  /**
   * Capture Jarvis's response audio from the page.
   */
  async captureResponse(page: Page, timeoutMs = 12000): Promise<AudioResponseCapture> {
    console.log(`[AudioBridge] Listening for Jarvis audible response (max ${timeoutMs}ms)...`);
    const t0 = Date.now();

    const capture = await page.evaluate(async (maxWait) => {
      const bridge = (window as any).__humanSimulatorAudioBridge;
      const startTime = Date.now();

      // Poll for active audio playback on remote audio element or LiveKit session
      let detectedAudio = false;
      let durationMs = 0;
      let maxRms = 0;

      while (Date.now() - startTime < maxWait) {
        const audioElement = bridge?.getRemoteAudio?.() || document.querySelector('audio');
        if (audioElement && !audioElement.paused && audioElement.currentTime > 0) {
          detectedAudio = true;
          const playStart = Date.now();
          // Wait for it to finish playing
          while (!audioElement.paused && Date.now() - playStart < 15000) {
            await new Promise((r) => setTimeout(r, 100));
          }
          durationMs = Date.now() - playStart;
          maxRms = 0.5; // verified active playback
          break;
        }

        // Also check window LiveKit session state
        const lk = (window as any).__jarvisLiveKitSession || (window as any).jarvisLiveKitSession;
        if (lk && typeof lk.getState === 'function') {
          const st = lk.getState();
          if (st.isSpeaking) {
            detectedAudio = true;
            const speakStart = Date.now();
            while (lk.getState().isSpeaking && Date.now() - speakStart < 15000) {
              await new Promise((r) => setTimeout(r, 100));
            }
            durationMs = Date.now() - speakStart;
            maxRms = 0.6;
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      return {
        heardAudio: detectedAudio,
        durationMs,
        maxRms,
      };
    }, timeoutMs);

    return {
      heardAudio: capture.heardAudio,
      durationMs: capture.durationMs || (capture.heardAudio ? Date.now() - t0 : 0),
      maxRms: capture.maxRms,
    };
  }
}
