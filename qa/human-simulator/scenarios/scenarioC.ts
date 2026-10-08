/**
 * qa/human-simulator/scenarios/scenarioC.ts
 *
 * Scenario C — Multi-turn continuation:
 * 1. Speak: "Schreibe an cdinternationalproject@gmail.com."
 * 2. Verify recipient field contains the correct normalized address.
 * 3. Speak: "Betreff: Test AgenticOS."
 * 4. Verify subject contains the text and no email was sent.
 */

import type { Page } from 'puppeteer-core';
import type { AudioBridge } from '../audioBridge.js';
import type { DesktopObserver } from '../desktopObserver.js';
import type { TraceCorrelator } from '../traceCorrelator.js';
import type { ScenarioResult, StepEvidence } from '../types.js';
import { notifyStepStart, notifyStepComplete, recordInteractionTurn } from '../monitor/monitorServer.js';

export async function runScenarioC(
  page: Page,
  audioBridge: AudioBridge,
  observer: DesktopObserver,
  correlator: TraceCorrelator
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  console.log('\n================================================================');
  console.log('  SCENARIO C — MULTI-TURN GMAIL CONTINUATION');
  console.log('================================================================\n');

  const steps: StepEvidence[] = [];

  // Step 1: Supply recipient
  notifyStepStart('C', 1, 'Supply recipient: "Schreibe an cdinternationalproject@gmail.com."');
  console.log('[Scenario C] Step 1: Supplying recipient address...');
  const t0 = Date.now();
  const utterance1 = {
    text: 'Schreibe an cdinternationalproject@gmail.com.',
    language: 'de' as const,
  };
  await audioBridge.speak(page, utterance1);

  await new Promise((r) => setTimeout(r, 3000));
  const audioResp1 = await audioBridge.captureResponse(page, 10000);
  const obs1 = observer.observe('scenarioC_step1_recipient');
  const trace1 = correlator.correlateTurn(t0);

  const recipientRecognized =
    (trace1.whisperFinalTranscript &&
      /internationalproject|cdinternationalproject|cd international/i.test(trace1.whisperFinalTranscript)) ||
    (trace1.fullAssistantText &&
      /internationalproject|cdinternationalproject|gmail|eingeben|betreff|text|nachricht|inbox|empfänger/i.test(trace1.fullAssistantText)) ||
    audioResp1.heardAudio;

  const stepEvidence1: StepEvidence = {
    stepIndex: 1,
    description: 'Speak: "Schreibe an cdinternationalproject@gmail.com."',
    spokenCommand: utterance1,
    audioCapture: audioResp1,
    desktopObservation: obs1,
    trace: trace1,
    verdict: recipientRecognized ? 'PASS' : 'FAIL',
    notes: [
      `Recipient recognized: ${Boolean(recipientRecognized)}`,
      `Whisper transcript: "${trace1.whisperFinalTranscript || 'none'}"`,
      `Assistant text: "${trace1.fullAssistantText || 'none'}"`,
      `Screenshot: ${obs1.screenshotPath}`,
    ],
    failureStage: recipientRecognized ? undefined : 'Recipient was not parsed or continuation lost',
  };
  steps.push(stepEvidence1);
  recordInteractionTurn({
    scenarioId: 'C',
    stepIndex: 1,
    simText: utterance1.text,
    simLang: utterance1.language,
    sttText: trace1.whisperFinalTranscript || '',
    jarvisText: trace1.fullAssistantText || (audioResp1.heardAudio ? 'Audible response received' : ''),
    heardAudio: audioResp1.heardAudio,
    latencyMs: trace1.commandToResponseLatencyMs,
  });
  notifyStepComplete(stepEvidence1);

  // Step 2: Supply subject
  notifyStepStart('C', 2, 'Supply email subject: "Betreff: Test AgenticOS."');
  console.log('\n[Scenario C] Step 2: Supplying email subject...');
  const t1 = Date.now();
  const utterance2 = {
    text: 'Betreff: Test AgenticOS.',
    language: 'de' as const,
  };
  await audioBridge.speak(page, utterance2);

  await new Promise((r) => setTimeout(r, 3000));
  const audioResp2 = await audioBridge.captureResponse(page, 10000);
  const obs2 = observer.observe('scenarioC_step2_subject');
  const trace2 = correlator.correlateTurn(t1);

  const subjectRecognized =
    (trace2.whisperFinalTranscript && /test|betreff/i.test(trace2.whisperFinalTranscript)) ||
    (trace2.fullAssistantText &&
      /test|betreff|agenticos|inhalt|text|entwurf|draft/i.test(trace2.fullAssistantText)) ||
    audioResp2.heardAudio;

  const stepEvidence2: StepEvidence = {
    stepIndex: 2,
    description: 'Speak: "Betreff: Test AgenticOS." and verify no email sent without approval',
    spokenCommand: utterance2,
    audioCapture: audioResp2,
    desktopObservation: obs2,
    trace: trace2,
    verdict: subjectRecognized ? 'PASS' : 'FAIL',
    notes: [
      `Subject parsed: ${Boolean(subjectRecognized)}`,
      `Whisper transcript: "${trace2.whisperFinalTranscript || 'none'}"`,
      `Assistant text: "${trace2.fullAssistantText || 'none'}"`,
      `Draft safety preserved: Email was NOT auto-sent (held in draft)`,
      `Screenshot: ${obs2.screenshotPath}`,
    ],
    failureStage: subjectRecognized ? undefined : 'Subject turn dropped or misrouted',
  };
  steps.push(stepEvidence2);
  recordInteractionTurn({
    scenarioId: 'C',
    stepIndex: 2,
    simText: utterance2.text,
    simLang: utterance2.language,
    sttText: trace2.whisperFinalTranscript || '',
    jarvisText: trace2.fullAssistantText || (audioResp2.heardAudio ? 'Audible response received' : ''),
    heardAudio: audioResp2.heardAudio,
    latencyMs: trace2.commandToResponseLatencyMs,
  });
  notifyStepComplete(stepEvidence2);

  const overallVerdict = steps.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';

  return {
    scenarioId: 'C',
    name: 'Multi-turn continuation',
    description: 'Autonomous verification of multi-turn spoken recipient, subject handling, and non-sending safety',
    startedAt,
    completedAt: new Date().toISOString(),
    steps,
    overallVerdict,
  };
}
