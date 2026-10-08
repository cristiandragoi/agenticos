/**
 * qa/human-simulator/monitor/monitorServer.ts
 *
 * Standalone Local Human Simulator QA Monitor Server.
 * Exposes a real-time web dashboard on port 4680 with Server-Sent Events (SSE).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopObservation, ScenarioResult, StepEvidence } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MONITOR_PORT = 4680;

export interface MonitorState {
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'DISCONNECTED';
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  frameCounter: number;
  activeScenarioId: string | null;
  activeScenarioName: string | null;
  activeStepIndex: number | null;
  activeStepDescription: string | null;
  simulatorSpeech: { text: string; language: string; runId?: string; scenarioId?: string; timestamp: number } | null;
  whisperTranscription: { text: string; language?: string; confidence?: number; runId?: string; scenarioId?: string; timestamp: number } | null;
  jarvisResponse: { text: string; audible: boolean; durationMs: number; latencyMs?: number; runId?: string; scenarioId?: string; timestamp: number } | null;
  desktop: {
    foregroundWindowTitle: string;
    foregroundProcessName: string;
    runningProcesses: string[];
    screenshotUrl?: string;
    frame: number;
    runId?: string;
    scenarioId?: string;
    timestamp: number;
  } | null;
  toolCalls: Array<{ timestamp: number; tool: string; args?: any; status: string; latencyMs?: number; runId?: string; scenarioId?: string }>;
  scenarioResults: Record<string, ScenarioResult>;
  recoveryAttempts: Array<{ timestamp: number; scenarioId: string; action: string; result: string; runId?: string }>;
  logs: Array<{ timestamp: number; level: string; message: string; runId?: string; scenarioId?: string }>;
}

let activeRunId = `RUN-${Date.now()}`;
let globalFrameCounter = 0;
let isPauseRequested = false;
let isStopRequested = false;

const state: MonitorState = {
  status: 'IDLE',
  runId: activeRunId,
  startedAt: null,
  completedAt: null,
  frameCounter: 0,
  activeScenarioId: null,
  activeScenarioName: null,
  activeStepIndex: null,
  activeStepDescription: null,
  simulatorSpeech: null,
  whisperTranscription: null,
  jarvisResponse: null,
  desktop: null,
  toolCalls: [],
  scenarioResults: {
    A: { scenarioId: 'A', name: 'Voice and Language', description: 'Voice & Language verification', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    B: { scenarioId: 'B', name: 'Gmail in Comet', description: 'Gmail in Comet browser', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    C: { scenarioId: 'C', name: 'Multi-turn continuation', description: 'Multi-turn email draft handling', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    D: { scenarioId: 'D', name: 'Interruption and task switching', description: 'Barge-in interruption & WhatsApp launch', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    E: { scenarioId: 'E', name: 'Failure recovery', description: 'Fault recovery and release of task latch', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
  },
  recoveryAttempts: [],
  logs: [],
};

const sseClients = new Set<http.ServerResponse>();
let serverInstance: http.Server | null = null;
let latestScreenshotBuffer: Buffer | null = null;
let runControllerCallbacks: { start?: () => void; pause?: () => void; stop?: () => void } = {};

function broadcast(eventType: string, data: any): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function logMonitor(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string): void {
  const entry = { timestamp: Date.now(), level, message, runId: activeRunId, scenarioId: state.activeScenarioId || undefined };
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs.shift();
  broadcast('log', entry);
}

export function notifySimulatorStart(newRunId?: string): void {
  activeRunId = newRunId || `RUN-${Date.now()}`;
  state.runId = activeRunId;
  state.status = 'RUNNING';
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  isPauseRequested = false;
  isStopRequested = false;
  state.activeScenarioId = null;
  state.activeScenarioName = null;
  state.activeStepIndex = null;
  state.activeStepDescription = null;
  state.simulatorSpeech = null;
  state.whisperTranscription = null;
  state.jarvisResponse = null;
  state.toolCalls = [];
  state.recoveryAttempts = [];
  state.logs = [];

  // Reset scenarios for clean run
  state.scenarioResults = {
    A: { scenarioId: 'A', name: 'Voice and Language', description: 'Voice & Language verification', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    B: { scenarioId: 'B', name: 'Gmail in Comet', description: 'Gmail in Comet browser', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    C: { scenarioId: 'C', name: 'Multi-turn continuation', description: 'Multi-turn email draft handling', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    D: { scenarioId: 'D', name: 'Interruption and task switching', description: 'Barge-in interruption & WhatsApp launch', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
    E: { scenarioId: 'E', name: 'Failure recovery', description: 'Fault recovery and release of task latch', startedAt: '', completedAt: '', steps: [], overallVerdict: 'UNVERIFIED' },
  };

  logMonitor('INFO', `Human Simulator run started: ${activeRunId}`);
  broadcast('status', { status: state.status, runId: activeRunId, startedAt: state.startedAt });
  broadcast('state_reset', state);
}

export function notifyScenarioStart(scenarioId: string, name: string, description: string): void {
  state.activeScenarioId = scenarioId;
  state.activeScenarioName = name;
  state.activeStepIndex = 1;
  state.activeStepDescription = description;
  if (state.scenarioResults[scenarioId]) {
    state.scenarioResults[scenarioId].startedAt = new Date().toISOString();
    state.scenarioResults[scenarioId].overallVerdict = 'RUNNING' as any;
  }
  logMonitor('INFO', `Starting Scenario ${scenarioId}: ${name}`);
  broadcast('scenario_start', { runId: activeRunId, scenarioId, name, description });
}

export function notifyStepStart(scenarioId: string, stepIndex: number, description: string): void {
  state.activeScenarioId = scenarioId;
  state.activeStepIndex = stepIndex;
  state.activeStepDescription = description;
  logMonitor('INFO', `[Scenario ${scenarioId}] Step ${stepIndex}: ${description}`);
  broadcast('step_start', { runId: activeRunId, scenarioId, stepIndex, description });
}

export function notifySimulatorSpoke(text: string, language: string): void {
  state.simulatorSpeech = { text, language, runId: activeRunId, scenarioId: state.activeScenarioId || undefined, timestamp: Date.now() };
  logMonitor('INFO', `[Simulator Spoke] (${language}): "${text}"`);
  broadcast('simulator_speech', state.simulatorSpeech);
}

export function notifyWhisperTranscribed(text: string, language?: string, confidence?: number): void {
  state.whisperTranscription = { text, language, confidence, runId: activeRunId, scenarioId: state.activeScenarioId || undefined, timestamp: Date.now() };
  logMonitor('INFO', `[Whisper STT] [lang=${language || 'auto'} conf=${confidence ?? '1.0'}]: "${text}"`);
  broadcast('whisper_transcription', state.whisperTranscription);
}

export function notifyJarvisReplied(text: string, audible: boolean, durationMs: number, latencyMs?: number): void {
  state.jarvisResponse = { text, audible, durationMs, latencyMs, runId: activeRunId, scenarioId: state.activeScenarioId || undefined, timestamp: Date.now() };
  logMonitor('SUCCESS', `[Jarvis Answered] audible=${audible} (${durationMs}ms): "${text}"`);
  broadcast('jarvis_response', state.jarvisResponse);
}

export function recordInteractionTurn(turn: {
  runId?: string;
  scenarioId?: string;
  stepIndex?: number;
  simText: string;
  simLang: string;
  sttText: string;
  jarvisText: string;
  heardAudio: boolean;
  latencyMs?: number;
}): void {
  const ts = Date.now();
  const run = turn.runId || activeRunId;
  const sc = turn.scenarioId || state.activeScenarioId || undefined;

  state.simulatorSpeech = { text: turn.simText, language: turn.simLang, runId: run, scenarioId: sc, timestamp: ts };
  state.whisperTranscription = { text: turn.sttText, runId: run, scenarioId: sc, timestamp: ts };
  state.jarvisResponse = { text: turn.jarvisText, audible: turn.heardAudio, durationMs: 0, latencyMs: turn.latencyMs, runId: run, scenarioId: sc, timestamp: ts };

  broadcast('simulator_speech', state.simulatorSpeech);
  broadcast('whisper_transcription', state.whisperTranscription);
  broadcast('jarvis_response', state.jarvisResponse);
}

export function notifyToolCall(tool: string, args: any, status: string, latencyMs?: number): void {
  const call = { timestamp: Date.now(), tool, args, status, latencyMs, runId: activeRunId, scenarioId: state.activeScenarioId || undefined };
  state.toolCalls.push(call);
  if (state.toolCalls.length > 100) state.toolCalls.shift();
  logMonitor('INFO', `[Tool Action] ${tool} [${status}] (${latencyMs ?? 0}ms)`);
  broadcast('tool_call', call);
}

export function notifyDesktopObserved(obs: DesktopObservation): void {
  globalFrameCounter++;
  state.frameCounter = globalFrameCounter;
  let screenshotUrl = undefined;
  if (obs.screenshotPath && fs.existsSync(obs.screenshotPath)) {
    try {
      latestScreenshotBuffer = fs.readFileSync(obs.screenshotPath);
      screenshotUrl = `/api/screenshot/latest?frame=${globalFrameCounter}&t=${Date.now()}`;
    } catch {}
  }
  state.desktop = {
    foregroundWindowTitle: obs.foregroundWindowTitle,
    foregroundProcessName: obs.foregroundProcessName,
    runningProcesses: obs.runningProcesses,
    screenshotUrl,
    frame: globalFrameCounter,
    runId: activeRunId,
    scenarioId: state.activeScenarioId || undefined,
    timestamp: Date.now(),
  };
  broadcast('desktop_state', state.desktop);
}

export function notifyStepComplete(step: StepEvidence): void {
  const scenario = state.scenarioResults[state.activeScenarioId || ''];
  if (scenario) {
    const existingIdx = scenario.steps.findIndex((s) => s.stepIndex === step.stepIndex);
    if (existingIdx >= 0) scenario.steps[existingIdx] = step;
    else scenario.steps.push(step);
  }
  const level = step.verdict === 'PASS' ? 'SUCCESS' : step.verdict === 'BLOCKED' ? 'WARN' : 'ERROR';
  logMonitor(level, `[Scenario ${state.activeScenarioId}] Step ${step.stepIndex} verdict: ${step.verdict}`);
  broadcast('step_complete', { runId: activeRunId, scenarioId: state.activeScenarioId, step });
}

export function notifyScenarioComplete(result: ScenarioResult): void {
  state.scenarioResults[result.scenarioId] = result;
  state.activeScenarioId = null;
  state.activeStepIndex = null;
  state.activeScenarioName = null;
  state.activeStepDescription = null;
  const level = result.overallVerdict === 'PASS' ? 'SUCCESS' : 'ERROR';
  logMonitor(level, `Scenario ${result.scenarioId} (${result.name}) completed with verdict: ${result.overallVerdict}`);
  broadcast('scenario_complete', { runId: activeRunId, scenario: result });
}

export function notifySimulatorFinished(allPassed: boolean): void {
  state.status = allPassed ? 'COMPLETED' : 'FAILED';
  state.completedAt = new Date().toISOString();
  state.activeScenarioId = null;
  state.activeStepIndex = null;
  state.activeScenarioName = null;
  state.activeStepDescription = null;
  logMonitor(allPassed ? 'SUCCESS' : 'ERROR', `Human Simulator suite finished. Overall: ${state.status}`);
  broadcast('status', { status: state.status, allPassed, runId: activeRunId, completedAt: state.completedAt });
  broadcast('simulator_finished', { status: state.status, allPassed, state });
}

export function notifyRecoveryAttempt(scenarioId: string, action: string, result: string): void {
  const item = { timestamp: Date.now(), scenarioId, action, result, runId: activeRunId };
  state.recoveryAttempts.push(item);
  logMonitor('WARN', `[Self-Heal Recovery] Scenario ${scenarioId}: ${action} -> ${result}`);
  broadcast('recovery_attempt', item);
}

export function setRunController(controller: { start?: () => void; pause?: () => void; stop?: () => void }): void {
  runControllerCallbacks = controller;
}

export function isPauseActive(): boolean {
  return isPauseRequested;
}

export function isStopActive(): boolean {
  return isStopRequested;
}

export function startMonitorServer(port = MONITOR_PORT): Promise<http.Server> {
  if (serverInstance) return Promise.resolve(serverInstance);

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const pathname = parsedUrl.pathname;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Control endpoints
      if (req.method === 'POST' && pathname === '/api/control/start') {
        logMonitor('INFO', '[Control] User requested START / RE-RUN');
        if (state.status === 'PAUSED') {
          isPauseRequested = false;
          state.status = 'RUNNING';
          broadcast('status', { status: 'RUNNING', runId: activeRunId });
        } else if (state.status === 'RUNNING') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Test already running' }));
          return;
        } else if (runControllerCallbacks.start) {
          runControllerCallbacks.start();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: state.status }));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/control/pause') {
        isPauseRequested = !isPauseRequested;
        state.status = isPauseRequested ? 'PAUSED' : 'RUNNING';
        logMonitor('WARN', `[Control] User requested ${isPauseRequested ? 'PAUSE' : 'RESUME'}`);
        broadcast('status', { status: state.status, runId: activeRunId });
        if (runControllerCallbacks.pause) runControllerCallbacks.pause();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: state.status, paused: isPauseRequested }));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/control/stop') {
        isStopRequested = true;
        state.status = 'IDLE';
        state.activeScenarioId = null;
        state.activeScenarioName = null;
        state.activeStepIndex = null;
        state.activeStepDescription = null;
        logMonitor('WARN', '[Control] User requested STOP');
        broadcast('status', { status: 'IDLE', runId: activeRunId });
        if (runControllerCallbacks.stop) runControllerCallbacks.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'IDLE' }));
        return;
      }

      // Serve SSE stream
      if (pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`event: initial_state\ndata: ${JSON.stringify(state)}\n\n`);
        sseClients.add(res);

        const heartbeat = setInterval(() => {
          res.write(': heartbeat\n\n');
        }, 15000);

        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(res);
        });
        return;
      }

      // Serve full state JSON
      if (pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state, null, 2));
        return;
      }

      // Serve latest desktop screenshot
      if (pathname === '/api/screenshot/latest') {
        if (latestScreenshotBuffer) {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Frame-Counter': String(globalFrameCounter),
          });
          res.end(latestScreenshotBuffer);
        } else {
          // Check if any recent screenshot exists on disk
          const screenshotDir = path.join(process.cwd(), 'qa', 'evidence', 'screenshots');
          if (fs.existsSync(screenshotDir)) {
            const files = fs.readdirSync(screenshotDir)
              .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
              .map((f) => ({ name: f, time: fs.statSync(path.join(screenshotDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (files.length > 0) {
              const latestFile = path.join(screenshotDir, files[0].name);
              latestScreenshotBuffer = fs.readFileSync(latestFile);
              res.writeHead(200, {
                'Content-Type': latestFile.endsWith('.png') ? 'image/png' : 'image/jpeg',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
              });
              res.end(latestScreenshotBuffer);
              return;
            }
          }
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('No screenshot captured yet.');
        }
        return;
      }

      // Serve specific screenshot by filename
      if (pathname.startsWith('/api/screenshot/')) {
        const filename = path.basename(pathname);
        const screenshotPath = path.join(process.cwd(), 'qa', 'evidence', 'screenshots', filename);
        if (fs.existsSync(screenshotPath)) {
          const isPng = filename.endsWith('.png');
          res.writeHead(200, { 'Content-Type': isPng ? 'image/png' : 'image/jpeg' });
          fs.createReadStream(screenshotPath).pipe(res);
          return;
        }
      }

      // Serve dashboard index.html
      const htmlPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><title>Human Simulator QA Monitor</title></head><body><h1>Human Simulator QA Monitor</h1><p>Running on port ${port}.</p></body></html>`);
      }
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`\n================================================================`);
      console.log(`  HUMAN SIMULATOR QA MONITOR ACTIVE: http://localhost:${port}`);
      console.log(`================================================================\n`);
      serverInstance = server;
      resolve(server);
    });
  });
}

export function stopMonitorServer(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    sseClients.clear();
    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
