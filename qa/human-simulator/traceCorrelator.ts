/**
 * qa/human-simulator/traceCorrelator.ts
 *
 * Reads runtime trace logs to correlate spoken turns with internal execution events,
 * latencies, and lifecycle outcomes.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TurnExecutionTrace } from './types.js';
import { notifyWhisperTranscribed, notifyJarvisReplied } from './monitor/monitorServer.js';

export class TraceCorrelator {
  private traceLogPath: string;

  constructor() {
    const candidates = [
      path.join(process.env.APPDATA || '', 'agenticos', 'data', 'jarvis-runtime-trace.log'),
      path.join(process.env.APPDATA || '', 'AgenticOS', 'data', 'jarvis-runtime-trace.log'),
      path.join(process.cwd(), 'data', 'jarvis-runtime-trace.log'),
    ];
    this.traceLogPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  /**
   * Reads the recent tail of the trace log.
   */
  readRecentLog(maxBytes = 131072): string {
    if (!fs.existsSync(this.traceLogPath)) return '';
    try {
      const fd = fs.openSync(this.traceLogPath, 'r');
      const stat = fs.fstatSync(fd);
      const readSize = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * Extract correlation metrics for turns occurring after a given start timestamp.
   */
  correlateTurn(startTime: number): TurnExecutionTrace {
    const logContent = this.readRecentLog(262144);
    const lines = logContent.split('\n');

    const trace: TurnExecutionTrace = {};

    let userSpeechEnd = 0;
    let execDispatch = 0;
    let ttsStart = 0;

    let currentLineTime = 0;
    for (const line of lines) {
      // Check timestamp if available
      const matchTs = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      if (matchTs) {
        currentLineTime = new Date(matchTs[1]).getTime();
      }
      if (currentLineTime && currentLineTime < startTime - 2000) continue;
      const lineTime = currentLineTime;

      if (line.includes('USER_SPEECH_START') || line.includes('SPEECH_START')) {
        const turnMatch = line.match(/turn=(\d+)/);
        if (turnMatch) trace.turnId = turnMatch[1];
        if (lineTime && !trace.userSpeechStartTs) trace.userSpeechStartTs = lineTime;
      }

      if (line.includes('USER_SPEECH_END') || line.includes('SPEECH_END')) {
        if (lineTime) userSpeechEnd = lineTime;
      }

      if (line.includes('WHISPER_FINAL_TRANSCRIPT=')) {
        trace.whisperFinalTranscript = line.split('WHISPER_FINAL_TRANSCRIPT=')[1]?.trim();
      } else if (line.includes('STT_SPECULATIVE_REUSE') && line.includes('text="')) {
        const m = line.match(/text="([^"]+)"/);
        if (m) trace.whisperFinalTranscript = m[1];
      }

      if (line.includes('NORMALIZED_TRANSCRIPT=')) {
        trace.normalizedTranscript = line.split('NORMALIZED_TRANSCRIPT=')[1]?.trim();
      }

      if (line.includes('EXECUTION_DISPATCHED')) {
        if (lineTime) {
          execDispatch = lineTime;
          trace.executionDispatchedTs = lineTime;
        }
      }

      if (line.includes('EXECUTION_VERIFIED')) {
        if (lineTime) trace.executionVerifiedTs = lineTime;
      }

      if (line.includes('TTS_NORMALIZED_TEXT')) {
        const m = line.match(/text="([^"]+)"/);
        if (m) trace.fullAssistantText = m[1];
      }

      if (
        line.includes('TTS_STARTED') ||
        line.includes('PLAYOUT_STARTED') ||
        line.includes('TTS_FIRST_CHUNK_STREAMED') ||
        line.includes('reason=tts_playout_start')
      ) {
        if (lineTime && !ttsStart) {
          ttsStart = lineTime;
          trace.ttsPlayoutStartTs = lineTime;
        }
      }

      if (line.includes('TTS_COMPLETED') || line.includes('PLAYOUT_COMPLETED') || line.includes('TTS_AUDIO_ENDED')) {
        if (lineTime) trace.ttsCompletedTs = lineTime;
      }

      if (line.includes('[TurnLifecycle] OUTCOME')) {
        try {
          const jsonPart = line.slice(line.indexOf('{'));
          const parsed = JSON.parse(jsonPart);
          trace.lifecycleOutcome = parsed.meta?.outcome || parsed.outcome;
          trace.lifecycleReason = parsed.meta?.reason || parsed.reason;
        } catch {}
      }
    }

    if (userSpeechEnd && execDispatch && execDispatch >= userSpeechEnd) {
      trace.commandToActionLatencyMs = execDispatch - userSpeechEnd;
    }
    if (userSpeechEnd && ttsStart && ttsStart >= userSpeechEnd) {
      trace.commandToResponseLatencyMs = ttsStart - userSpeechEnd;
    }

    try {
      if (trace.whisperFinalTranscript) {
        notifyWhisperTranscribed(trace.whisperFinalTranscript);
      }
      if (trace.fullAssistantText) {
        notifyJarvisReplied(trace.fullAssistantText, true, 0, trace.commandToResponseLatencyMs);
      }
    } catch {}

    return trace;
  }
}
