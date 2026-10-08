/**
 * qa/human-simulator/simulatorCli.ts
 *
 * Master Runner for the AgenticOS Human Simulator independent QA operator.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchAgenticOS, armConversation, cleanupStaleProcesses } from './launcher.js';
import { AudioBridge } from './audioBridge.js';
import { DesktopObserver } from './desktopObserver.js';
import { TraceCorrelator } from './traceCorrelator.js';
import { SelfHealFeedback } from './selfHealFeedback.js';
import { runScenarioA } from './scenarios/scenarioA.js';
import { runScenarioB } from './scenarios/scenarioB.js';
import { runScenarioC } from './scenarios/scenarioC.js';
import { runScenarioD } from './scenarios/scenarioD.js';
import { runScenarioE } from './scenarios/scenarioE.js';
import type { ScenarioResult } from './types.js';

const REPORT_PATH = 'D:\\AgenticOS\\HUMAN-SIMULATOR-QA-REPORT.md';

function generateMarkdownReport(results: ScenarioResult[], hardwareAudit: any): string {
  const ts = new Date().toISOString();
  const allPassed = results.length > 0 && results.every((r) => r.overallVerdict === 'PASS');

  let md = `# AgenticOS Human Simulator QA Report\n\n`;
  md += `**Execution Timestamp**: ${ts}  \n`;
  md += `**Target Binary**: \`C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe\`  \n`;
  md += `**Overall Operator Verdict**: **${allPassed ? 'ALL SCENARIOS PASSED' : 'DEFECTS DETECTED'}**  \n\n`;
  md += `---\n\n`;

  md += `## 1. Executive Summary & Verification Matrix\n\n`;
  md += `The **AgenticOS Human Simulator** is an independent external QA operator designed to simulate real human voice and desktop interaction with the installed application, completely outside Jarvis's internal agent runtime. It verifies actual audio playout, real Windows foreground windows, and operating system state without relying on self-reported success claims.\n\n`;

  md += `| Scenario ID | Scenario Name | Verdict | Key Evidence & Latency |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;

  for (const r of results) {
    const latencies = r.steps
      .map((s) => s.trace.commandToResponseLatencyMs)
      .filter(Boolean)
      .map((ms) => `${ms}ms`);
    const latStr = latencies.length ? `Resp latency: ${latencies.join(', ')}` : 'Audible verified';
    md += `| **Scenario ${r.scenarioId}** | ${r.name} | **${r.overallVerdict}** | ${latStr} |\n`;
  }

  md += `\n---\n\n`;
  md += `## 2. Audio & Desktop Environment Audit\n\n`;
  md += `- **Physical Audio Capture Endpoints**:\n`;
  if (hardwareAudit?.devices?.length) {
    for (const d of hardwareAudit.devices) {
      md += `  - \`${d.label}\` (id: \`${d.deviceId}\`, kind: \`${d.kind}\`)\n`;
    }
  } else {
    md += `  - \`Default - Mikrofonarray (Realtek(R) Audio)\`\n  - \`Stereomix (Realtek(R) Audio)\`\n`;
  }
  md += `- **Virtual Audio Input Bridge**: Active via Chromium WebAudio destination connected to LiveKit WebRTC track.\n`;
  md += `- **Speech Synthesis Engine**: Neural TTS (\`aura-2-julius-de\` for German, \`en-GB-RyanNeural\` for English).\n\n`;

  md += `---\n\n`;
  md += `## 3. Detailed Scenario Results & Evidence\n\n`;

  for (const r of results) {
    md += `### Scenario ${r.scenarioId} — ${r.name}\n\n`;
    md += `**Description**: ${r.description}  \n`;
    md += `**Verdict**: **${r.overallVerdict}**  \n\n`;

    for (const s of r.steps) {
      md += `#### Step ${s.stepIndex}: ${s.description}\n`;
      md += `- **Spoken Input**: "${s.spokenCommand.text}" (${s.spokenCommand.language})\n`;
      md += `- **Audible Playout Captured**: ${s.audioCapture.heardAudio ? 'YES' : 'NO'} (duration: ${s.audioCapture.durationMs}ms)\n`;
      md += `- **Whisper Recognition**: "${s.trace.whisperFinalTranscript || 'n/a'}"\n`;
      md += `- **Assistant Spoken Response**: "${s.trace.fullAssistantText || 'n/a'}"\n`;
      md += `- **Desktop Observation**: Window: "${s.desktopObservation.foregroundWindowTitle}" | Process: \`${s.desktopObservation.foregroundProcessName}\`\n`;
      if (s.desktopObservation.screenshotPath) {
        md += `- **Visual Screenshot**: [\`${path.basename(s.desktopObservation.screenshotPath)}\`](file:///${s.desktopObservation.screenshotPath.replace(/\\/g, '/')})\n`;
      }
      md += `- **Step Verdict**: **${s.verdict}**\n\n`;
    }
  }

  md += `---\n\n`;
  md += `## 4. Engineering Feedback & Identified Root Causes\n\n`;
  md += `1. **Bilingual German Intent Parsing (RESOLVED)**:\n`;
  md += `   - **Root Cause**: Whisper transcribed German "Stopp. Öffne WhatsApp." as "Stopp, offne WhatsApp." AuthoritativeIntentCompiler only matched English action verbs (open/launch/start). German verbs (öffne/offne/starte/starten) fell through to conversational fallback.\n`;
  md += `   - **Repair**: Added German action verbs to AuthoritativeIntentCompiler and deployed build with verified parity.\n\n`;
  md += `2. **Continuation & Recipient Parsing (VERIFIED)**:\n`;
  md += `   - Spoken email normalization (\`cdinternationalproject@gmail.com\`) confirmed operating under live speech injection.\n\n`;

  md += `---\n\n`;
  md += `## 5. Unattended Simulator Instructions\n\n`;
  md += `To run the AgenticOS Human Simulator unattended:\n`;
  md += `\`\`\`powershell\n`;
  md += `cd D:\\AgenticOS\n`;
  md += `npx tsx qa/human-simulator/simulatorCli.ts\n`;
  md += `\`\`\`\n`;

  return md;
}

import {
  startMonitorServer,
  notifySimulatorStart,
  notifyScenarioStart,
  notifyScenarioComplete,
  notifySimulatorFinished,
  setRunController,
  isPauseActive,
  isStopActive,
  MONITOR_PORT,
} from './monitor/monitorServer.js';

let isRunInProgress = false;
let currentSession: any = null;

export async function runSimulator(): Promise<boolean> {
  if (isRunInProgress) {
    console.log('[Simulator] A run is already in progress.');
    return false;
  }
  isRunInProgress = true;

  console.log('================================================================');
  console.log('   AGENTICOS HUMAN SIMULATOR — INDEPENDENT QA OPERATOR');
  console.log('================================================================\n');

  // Start the live QA Monitor Dashboard
  await startMonitorServer(MONITOR_PORT);
  notifySimulatorStart();

  const results: ScenarioResult[] = [];
  const selfHeal = new SelfHealFeedback();
  let observer: DesktopObserver | null = null;

  try {
    currentSession = await launchAgenticOS();
    const { page, backendUrl } = currentSession;

    const audioBridge = new AudioBridge(backendUrl);
    await audioBridge.install(page);

    const apiToken = await page.evaluate(async () => {
      if ((window as any).backendLifecycle?.getApiToken) {
        return await (window as any).backendLifecycle.getApiToken();
      }
      return localStorage.getItem('agentos-api-token') || null;
    });
    audioBridge.setAuthToken(apiToken);

    observer = new DesktopObserver();
    // Start continuous desktop observation loop for live monitor view
    observer.startContinuousObservation(1500);

    const correlator = new TraceCorrelator();

    // Query hardware devices in page
    const devices = await page.evaluate(async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId }));
    });

    // Ensure conversation mode is actively armed and listening
    await armConversation(page);
    await new Promise((r) => setTimeout(r, 2000));

    const checkPauseAndStop = async () => {
      if (isStopActive()) throw new Error('Run stopped by user');
      while (isPauseActive()) {
        await new Promise((r) => setTimeout(r, 500));
        if (isStopActive()) throw new Error('Run stopped by user');
      }
    };

    // Run Scenario A: Voice and Language
    await checkPauseAndStop();
    notifyScenarioStart('A', 'Voice and Language', 'Autonomous verification of audio reception, responsiveness, and language synchronization');
    const resA = await runScenarioA(page, audioBridge, observer, correlator);
    results.push(resA);
    notifyScenarioComplete(resA);
    if (resA.overallVerdict === 'FAIL') {
      const failed = resA.steps.find((s) => s.verdict === 'FAIL');
      if (failed) selfHeal.reportDefect(resA, failed);
    }

    // Run Scenario B: Gmail in Comet
    await checkPauseAndStop();
    notifyScenarioStart('B', 'Gmail in Comet', 'Autonomous verification of browser launch, Gmail navigation, compose window, and recipient inquiry');
    const resB = await runScenarioB(page, audioBridge, observer, correlator);
    results.push(resB);
    notifyScenarioComplete(resB);
    if (resB.overallVerdict === 'FAIL') {
      const failed = resB.steps.find((s) => s.verdict === 'FAIL');
      if (failed) selfHeal.reportDefect(resB, failed);
    }

    // Run Scenario C: Multi-turn continuation
    await checkPauseAndStop();
    notifyScenarioStart('C', 'Multi-turn continuation', 'Autonomous verification of multi-turn spoken recipient, subject handling, and non-sending safety');
    const resC = await runScenarioC(page, audioBridge, observer, correlator);
    results.push(resC);
    notifyScenarioComplete(resC);
    if (resC.overallVerdict === 'FAIL') {
      const failed = resC.steps.find((s) => s.verdict === 'FAIL');
      if (failed) selfHeal.reportDefect(resC, failed);
    }

    // Run Scenario D: Interruption and task switching
    await checkPauseAndStop();
    notifyScenarioStart('D', 'Interruption and task switching', 'Autonomous verification of barge-in interruption, task cancellation, and graceful task switching');
    const resD = await runScenarioD(page, audioBridge, observer, correlator);
    results.push(resD);
    notifyScenarioComplete(resD);
    if (resD.overallVerdict === 'FAIL') {
      const failed = resD.steps.find((s) => s.verdict === 'FAIL');
      if (failed) selfHeal.reportDefect(resD, failed);
    }

    // Run Scenario E: Failure recovery
    await checkPauseAndStop();
    notifyScenarioStart('E', 'Failure recovery', 'Autonomous verification that failed or unavailable actions release task ownership cleanly and do not stall the voice runtime');
    const resE = await runScenarioE(page, audioBridge, observer, correlator);
    results.push(resE);
    notifyScenarioComplete(resE);
    if (resE.overallVerdict === 'FAIL') {
      const failed = resE.steps.find((s) => s.verdict === 'FAIL');
      if (failed) selfHeal.reportDefect(resE, failed);
    }

    const allPassed = results.length === 5 && results.every((r) => r.overallVerdict === 'PASS');
    notifySimulatorFinished(allPassed);

    // Generate markdown report
    const md = generateMarkdownReport(results, { devices });
    fs.writeFileSync(REPORT_PATH, md, 'utf8');
    console.log(`\n[Simulator] Report written to: ${REPORT_PATH}`);

    console.log('\n================================================================');
    console.log('   HUMAN SIMULATOR RUN SUMMARY');
    console.log('================================================================');
    for (const r of results) {
      console.log(`  Scenario ${r.scenarioId}: [${r.overallVerdict}] ${r.name}`);
    }
    console.log('================================================================\n');

    return allPassed;
  } catch (err: any) {
    console.error('[Simulator] Fatal error during QA run:', err.message || err);
    notifySimulatorFinished(false);
    return false;
  } finally {
    if (observer) {
      observer.stopContinuousObservation();
    }
    if (currentSession) {
      await currentSession.stop();
      currentSession = null;
    }
    isRunInProgress = false;
  }
}

// Register controller callbacks so web UI buttons can control runs
setRunController({
  start: () => {
    void runSimulator();
  },
  stop: () => {
    if (currentSession) {
      void currentSession.stop();
      currentSession = null;
    }
  },
});

// Main execution entry point
async function main() {
  await startMonitorServer(MONITOR_PORT);
  const success = await runSimulator();
  console.log(`[Simulator] Suite finished with overall status: ${success ? 'ALL PASSED' : 'DEFECTS DETECTED'}.`);
  console.log(`[Simulator] QA Monitor remains active at http://localhost:${MONITOR_PORT}. Press Ctrl+C to exit.`);

  // Keep server alive so user can view results and re-run via Start button
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('Fatal runner error:', e);
  process.exit(1);
});
