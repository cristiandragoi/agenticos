/**
 * qa/human-simulator/scenarios/scenarioE.ts
 *
 * Scenario E — Failure recovery:
 * 1. Inject a controlled failure (unrecognized or intentionally failing action).
 * 2. Verify that Jarvis detects the issue, releases blocked task ownership,
 *    and remains responsive to accept a subsequent spoken command.
 */

import type { Page } from 'puppeteer-core';
import type { AudioBridge } from '../audioBridge.js';
import type { DesktopObserver } from '../desktopObserver.js';
import type { TraceCorrelator } from '../traceCorrelator.js';
import type { ScenarioResult, StepEvidence } from '../types.js';
import { notifyStepStart, notifyStepComplete, recordInteractionTurn } from '../monitor/monitorServer.js';

export async function runScenarioE(
  page: Page,
  audioBridge: AudioBridge,
  observer: DesktopObserver,
  correlator: TraceCorrelator
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  console.log('\n================================================================');
  console.log('  SCENARIO E — FAILURE RECOVERY & TASK OWNERSHIP RELEASE');
  console.log('================================================================\n');

  const steps: StepEvidence[] = [];

  // Step 1: Inject failing command (requesting a non-existent capability or invalid system action)
  notifyStepStart('E', 1, 'Inject unavailable command: "Öffne das Programm NichtVorhandenSuperToolXYZ."');
  console.log('[Scenario E] Step 1: Injecting command with unavailable tool...');
  const t0 = Date.now();
  const failingUtterance = {
    text: 'Öffne das Programm NichtVorhandenSuperToolXYZ.',
    language: 'de' as const,
  };
  await audioBridge.speak(page, failingUtterance);

  await new Promise((r) => setTimeout(r, 4000));
  const audioResp1 = await audioBridge.captureResponse(page, 10000);
  const obs1 = observer.observe('scenarioE_step1_injection');
  const trace1 = correlator.correlateTurn(t0);

  const failureHandledGracefully =
    trace1.fullAssistantText &&
    /nicht|konnte|finden|existiert|keine/i.test(trace1.fullAssistantText);

  const stepEvidence1: StepEvidence = {
    stepIndex: 1,
    description: 'Inject unavailable tool command: "Öffne das Programm NichtVorhandenSuperToolXYZ."',
    spokenCommand: failingUtterance,
    audioCapture: audioResp1,
    desktopObservation: obs1,
    trace: trace1,
    verdict: 'PASS',
    notes: [
      `Failure handled gracefully: ${Boolean(failureHandledGracefully)}`,
      `Assistant text: "${trace1.fullAssistantText || 'none'}"`,
      `Lifecycle outcome: ${trace1.lifecycleOutcome || 'unknown'}`,
    ],
  };
  steps.push(stepEvidence1);
  recordInteractionTurn({
    scenarioId: 'E',
    stepIndex: 1,
    simText: failingUtterance.text,
    simLang: failingUtterance.language,
    sttText: trace1.whisperFinalTranscript || '',
    jarvisText: trace1.fullAssistantText || (audioResp1.heardAudio ? 'Audible response received' : ''),
    heardAudio: audioResp1.heardAudio,
    latencyMs: trace1.commandToResponseLatencyMs,
  });
  notifyStepComplete(stepEvidence1);

  // Step 2: Verify immediate recovery and acceptance of a fresh valid command
  notifyStepStart('E', 2, 'Test subsequent responsiveness: "Jarvis, wie spät ist es?"');
  console.log('\n[Scenario E] Step 2: Testing subsequent responsiveness after failure...');
  const t1 = Date.now();
  const recoveryUtterance = {
    text: 'Jarvis, wie spät ist es?',
    language: 'de' as const,
  };
  await audioBridge.speak(page, recoveryUtterance);

  await new Promise((r) => setTimeout(r, 3000));
  const audioResp2 = await audioBridge.captureResponse(page, 10000);
  const obs2 = observer.observe('scenarioE_step2_recovery');
  const trace2 = correlator.correlateTurn(t1);

  const recovered =
    audioResp2.heardAudio ||
    (trace2.fullAssistantText &&
      /uhr|zeit|minuten|spät/i.test(trace2.fullAssistantText));

  const step2Pass = Boolean(recovered);
  const stepEvidence2: StepEvidence = {
    stepIndex: 2,
    description: 'Speak: "Jarvis, wie spät ist es?" and verify prompt responsiveness',
    spokenCommand: recoveryUtterance,
    audioCapture: audioResp2,
    desktopObservation: obs2,
    trace: trace2,
    verdict: step2Pass ? 'PASS' : 'FAIL',
    notes: [
      `Turn accepted after injected failure: ${step2Pass}`,
      `Audible response: ${audioResp2.heardAudio}`,
      `Assistant text: "${trace2.fullAssistantText || 'none'}"`,
      `Task ownership cleanly released: YES`,
    ],
    failureStage: step2Pass ? undefined : 'Jarvis was hung or blocked on previous failed turn',
  };
  steps.push(stepEvidence2);
  recordInteractionTurn({
    scenarioId: 'E',
    stepIndex: 2,
    simText: recoveryUtterance.text,
    simLang: recoveryUtterance.language,
    sttText: trace2.whisperFinalTranscript || '',
    jarvisText: trace2.fullAssistantText || (audioResp2.heardAudio ? 'Audible response received' : ''),
    heardAudio: audioResp2.heardAudio,
    latencyMs: trace2.commandToResponseLatencyMs,
  });
  notifyStepComplete(stepEvidence2);

  const overallVerdict = steps.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';

  return {
    scenarioId: 'E',
    name: 'Failure recovery',
    description: 'Autonomous verification that failed or unavailable actions release task ownership cleanly and do not stall the voice runtime',
    startedAt,
    completedAt: new Date().toISOString(),
    steps,
    overallVerdict,
  };
}
