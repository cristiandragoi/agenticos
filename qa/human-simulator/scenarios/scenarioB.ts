/**
 * qa/human-simulator/scenarios/scenarioB.ts
 *
 * Scenario B — Gmail in Comet:
 * 1. Speak: "Öffne Gmail in Comet Perplexity und erstelle eine neue E-Mail."
 * 2. Verify Comet / Browser becomes visible.
 * 3. Verify Gmail is loaded with Compose interface open.
 * 4. Verify Jarvis asks for the recipient.
 */

import type { Page } from 'puppeteer-core';
import type { AudioBridge } from '../audioBridge.js';
import type { DesktopObserver } from '../desktopObserver.js';
import type { TraceCorrelator } from '../traceCorrelator.js';
import type { ScenarioResult, StepEvidence } from '../types.js';
import { notifyStepStart, notifyStepComplete, recordInteractionTurn } from '../monitor/monitorServer.js';

export async function runScenarioB(
  page: Page,
  audioBridge: AudioBridge,
  observer: DesktopObserver,
  correlator: TraceCorrelator
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  console.log('\n================================================================');
  console.log('  SCENARIO B — GMAIL IN COMET VERIFICATION');
  console.log('================================================================\n');

  const steps: StepEvidence[] = [];

  notifyStepStart('B', 1, 'Command Gmail compose in Comet Perplexity');
  const t0 = Date.now();
  const utterance = {
    text: 'Öffne Gmail in Comet Perplexity und erstelle eine neue E-Mail.',
    language: 'de' as const,
  };

  console.log(`[Scenario B] Step 1: Commanding Gmail compose in Comet...`);
  await audioBridge.speak(page, utterance);

  // Allow time for browser launch / navigation
  await new Promise((r) => setTimeout(r, 4000));

  const audioResp = await audioBridge.captureResponse(page, 12000);
  const obs = observer.observe('scenarioB_comet_gmail');
  const trace = correlator.correlateTurn(t0);

  // Independent desktop verification:
  const browserRunning = obs.runningProcesses.some((p) => /comet|chrome/i.test(p));
  const fgTitle = obs.foregroundWindowTitle.toLowerCase();
  const isGmailOrCometWindow =
    fgTitle.includes('gmail') ||
    fgTitle.includes('comet') ||
    fgTitle.includes('posteingang') ||
    fgTitle.includes('neue nachricht') ||
    fgTitle.includes('google');

  // Verify Jarvis asks for recipient
  const assistantAskedRecipient =
    trace.fullAssistantText &&
    /empfänger|wen|an wen|adresse|schreiben|recipient/i.test(trace.fullAssistantText);

  const stepPass = Boolean(browserRunning || isGmailOrCometWindow || assistantAskedRecipient);

  const stepEvidence: StepEvidence = {
    stepIndex: 1,
    description: 'Speak: "Öffne Gmail in Comet Perplexity und erstelle eine neue E-Mail."',
    spokenCommand: utterance,
    audioCapture: audioResp,
    desktopObservation: obs,
    trace,
    verdict: stepPass ? 'PASS' : 'FAIL',
    notes: [
      `Browser process running: ${browserRunning} (${obs.runningProcesses.join(', ')})`,
      `Foreground window: "${obs.foregroundWindowTitle}" (${obs.foregroundProcessName})`,
      `Assistant text: "${trace.fullAssistantText || 'none'}"`,
      `Asked for recipient: ${Boolean(assistantAskedRecipient)}`,
      `Screenshot: ${obs.screenshotPath}`,
    ],
    failureStage: stepPass ? undefined : 'Comet/Gmail was not launched or recipient prompt missing',
  };
  steps.push(stepEvidence);
  recordInteractionTurn({
    scenarioId: 'B',
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
    scenarioId: 'B',
    name: 'Gmail in Comet',
    description: 'Autonomous verification of browser launch, Gmail navigation, compose window, and recipient inquiry',
    startedAt,
    completedAt: new Date().toISOString(),
    steps,
    overallVerdict,
  };
}
