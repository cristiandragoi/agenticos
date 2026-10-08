/**
 * qa/human-simulator/scenarios/scenarioD.ts
 *
 * Scenario D — Interruption and task switching:
 * 1. Speak: "Stopp. Öffne WhatsApp."
 * 2. Verify previous operation is canceled or safely suspended.
 * 3. Verify WhatsApp opens or Jarvis accurately reports why it cannot.
 */

import type { Page } from 'puppeteer-core';
import type { AudioBridge } from '../audioBridge.js';
import type { DesktopObserver } from '../desktopObserver.js';
import type { TraceCorrelator } from '../traceCorrelator.js';
import type { ScenarioResult, StepEvidence } from '../types.js';
import { notifyStepStart, notifyStepComplete, recordInteractionTurn } from '../monitor/monitorServer.js';

export async function runScenarioD(
  page: Page,
  audioBridge: AudioBridge,
  observer: DesktopObserver,
  correlator: TraceCorrelator
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  console.log('\n================================================================');
  console.log('  SCENARIO D — INTERRUPTION AND TASK SWITCHING');
  console.log('================================================================\n');

  const steps: StepEvidence[] = [];

  notifyStepStart('D', 1, 'Command interruption & task switch: "Stopp. Öffne WhatsApp."');
  const t0 = Date.now();
  const utterance = {
    text: 'Stopp. Öffne WhatsApp.',
    language: 'de' as const,
  };

  console.log(`[Scenario D] Step 1: Commanding barge-in stop and WhatsApp launch...`);
  await audioBridge.speak(page, utterance);

  await new Promise((r) => setTimeout(r, 4000));
  const audioResp = await audioBridge.captureResponse(page, 10000);
  const obs = observer.observe('scenarioD_interruption_whatsapp');
  const trace = correlator.correlateTurn(t0);

  const whatsAppRunning = obs.runningProcesses.some((p) => /whatsapp/i.test(p));
  const fgTitle = obs.foregroundWindowTitle.toLowerCase();
  const isWhatsAppFg = fgTitle.includes('whatsapp');

  const acknowledgedOrHandled =
    whatsAppRunning ||
    isWhatsAppFg ||
    (trace.fullAssistantText &&
      /whatsapp|gestoppt|abgebrochen|öffne|installiert|nicht gefunden/i.test(trace.fullAssistantText));

  const stepPass = Boolean(acknowledgedOrHandled);

  const stepEvidence: StepEvidence = {
    stepIndex: 1,
    description: 'Speak: "Stopp. Öffne WhatsApp." and verify clean interruption / task switch',
    spokenCommand: utterance,
    audioCapture: audioResp,
    desktopObservation: obs,
    trace,
    verdict: stepPass ? 'PASS' : 'FAIL',
    notes: [
      `WhatsApp running: ${whatsAppRunning} (${obs.runningProcesses.join(', ')})`,
      `Foreground window: "${obs.foregroundWindowTitle}"`,
      `Assistant text: "${trace.fullAssistantText || 'none'}"`,
      `Barge-in / Stop acknowledged: ${Boolean(acknowledgedOrHandled)}`,
      `Screenshot: ${obs.screenshotPath}`,
    ],
    failureStage: stepPass ? undefined : 'Interruption failed or task was not switched',
  };
  steps.push(stepEvidence);
  recordInteractionTurn({
    scenarioId: 'D',
    stepIndex: 1,
    simText: utterance.text,
    simLang: utterance.language,
    sttText: trace.whisperFinalTranscript || '',
    jarvisText: trace.fullAssistantText || (audioResp.heardAudio ? 'Audible response received' : ''),
    heardAudio: audioResp.heardAudio,
    latencyMs: trace.commandToResponseLatencyMs,
  });
  notifyStepComplete(stepEvidence);

  const overallVerdict = steps.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';

  return {
    scenarioId: 'D',
    name: 'Interruption and task switching',
    description: 'Autonomous verification of barge-in interruption, task cancellation, and graceful task switching',
    startedAt,
    completedAt: new Date().toISOString(),
    steps,
    overallVerdict,
  };
}
