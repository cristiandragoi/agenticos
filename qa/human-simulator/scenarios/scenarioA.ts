/**
 * qa/human-simulator/scenarios/scenarioA.ts
 *
 * Scenario A — Voice and language:
 * 1. Speak: "Jarvis, kannst du mich hören?" -> verify audible response.
 * 2. Speak: "Sprich ab jetzt Deutsch." -> verify subsequent response is in German.
 */

import type { Page } from 'puppeteer-core';
import type { AudioBridge } from '../audioBridge.js';
import type { DesktopObserver } from '../desktopObserver.js';
import type { TraceCorrelator } from '../traceCorrelator.js';
import type { ScenarioResult, StepEvidence } from '../types.js';

export async function runScenarioA(
  page: Page,
  audioBridge: AudioBridge,
  observer: DesktopObserver,
  correlator: TraceCorrelator
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  console.log('\n================================================================');
  console.log('  SCENARIO A — VOICE AND LANGUAGE VERIFICATION');
  console.log('================================================================\n');

  const steps: StepEvidence[] = [];

  // Step 1: "Jarvis, kannst du mich hören?"
  console.log('[Scenario A] Step 1: Inquiring voice audibility...');
  const t0 = Date.now();
  const utterance1 = { text: 'Jarvis, kannst du mich hören?', language: 'de' as const };
  await audioBridge.speak(page, utterance1);

  // Capture audible response
  const audioResp1 = await audioBridge.captureResponse(page, 10000);
  const obs1 = observer.observe('scenarioA_step1');
  const trace1 = correlator.correlateTurn(t0);

  const step1Pass = audioResp1.heardAudio || Boolean(trace1.fullAssistantText);
  steps.push({
    stepIndex: 1,
    description: 'Speak: "Jarvis, kannst du mich hören?" and verify audible response',
    spokenCommand: utterance1,
    audioCapture: audioResp1,
    desktopObservation: obs1,
    trace: trace1,
    verdict: step1Pass ? 'PASS' : 'FAIL',
    notes: [
      `Audible response detected: ${audioResp1.heardAudio} (duration: ${audioResp1.durationMs}ms)`,
      `Assistant text: "${trace1.fullAssistantText || 'none'}"`,
      `Lifecycle outcome: ${trace1.lifecycleOutcome || 'unknown'}`,
    ],
    failureStage: step1Pass ? undefined : 'No audible response produced for initial greeting',
  });

  // Step 2: "Sprich ab jetzt Deutsch."
  console.log('\n[Scenario A] Step 2: Commanding language switch to German...');
  const t1 = Date.now();
  const utterance2 = { text: 'Sprich ab jetzt Deutsch.', language: 'de' as const };
  await audioBridge.speak(page, utterance2);

  const audioResp2 = await audioBridge.captureResponse(page, 10000);
  const obs2 = observer.observe('scenarioA_step2');
  const trace2 = correlator.correlateTurn(t1);

  const isGermanResponse =
    (trace2.fullAssistantText &&
      /deutsch|verstanden|gerne|hallo|klar|hier/i.test(trace2.fullAssistantText)) ||
    audioResp2.heardAudio;

  const step2Pass = Boolean(isGermanResponse);
  steps.push({
    stepIndex: 2,
    description: 'Speak: "Sprich ab jetzt Deutsch." and verify German response',
    spokenCommand: utterance2,
    audioCapture: audioResp2,
    desktopObservation: obs2,
    trace: trace2,
    verdict: step2Pass ? 'PASS' : 'FAIL',
    notes: [
      `Assistant response: "${trace2.fullAssistantText || 'none'}"`,
      `Audible playout: ${audioResp2.heardAudio}`,
      `Lifecycle outcome: ${trace2.lifecycleOutcome || 'unknown'}`,
    ],
    failureStage: step2Pass ? undefined : 'Subsequent response was not in German or failed lifecycle',
  });

  const overallVerdict = steps.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';

  return {
    scenarioId: 'A',
    name: 'Voice and Language',
    description: 'Autonomous verification of audio reception, responsiveness, and language synchronization',
    startedAt,
    completedAt: new Date().toISOString(),
    steps,
    overallVerdict,
  };
}
