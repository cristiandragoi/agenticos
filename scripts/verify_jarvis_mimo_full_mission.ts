import { getAgentModelPolicy } from '../server/src/services/gateway/agentModelPolicy.js';
import { getAuthoritativeRoutingInfo, handleSystemIntrospection } from '../server/src/domains/jarvis/systemIntrospection.js';
import { isUtteranceComplete, decideContinuation } from '../src/utils/utteranceCompleteness.js';
import { universalExecutionController } from '../server/src/domains/jarvis/execution/universalExecutionController.js';
import { browserOperator } from '../server/src/services/browser/browserOperator.js';
import { browserExecutor } from '../server/src/domains/jarvis/execution/executors/browserExecutor.js';
import { projectsStore } from '../server/src/services/projectsStore.js';
import { llmChat } from '../server/src/services/llmGateway.js';
import { routeTurn } from '../server/src/domains/jarvisNext/turnRouter.js';
import { secretStore } from '../server/src/services/secretStore.js';

interface BenchmarkRun {
  modelKey: string;
  provider: string;
  model: string;
  prompt: string;
  responseLatencyMs: number;
  reply: string;
  error?: string;
  toolCallValid?: boolean;
}

async function runBenchmark() {
  console.log('\n======================================================');
  console.log('PART 8: MiMo A/B BENCHMARK COMPARISON');
  console.log('======================================================\n');

  const models = [
    { key: 'Model A (Previous Jarvis Local)', provider: 'ollama', model: 'qwen3.5:9b-hermes-64k' },
    { key: 'Model B (Xiaomi MiMo 2.6 Flash)', provider: 'openrouter', model: 'xiaomi/mimo-v2.6-flash' },
    { key: 'Model C (Xiaomi MiMo 2.6 Pro)', provider: 'openrouter', model: 'xiaomi/mimo-v2.6-pro' },
  ];

  const testPrompts = [
    { name: 'Conversational Greeting', prompt: 'Hello Jarvis. Who are you and how can you help me today?' },
    { name: 'Instruction Following & Tool Call', prompt: 'Please output a JSON tool call to open YouTube in the browser with target "YouTube" and url "https://www.youtube.com". Reply only with JSON.' },
    { name: 'Complex Desktop Operational Reasoning', prompt: 'We are working on an e-commerce platform and the payment gateway is returning status code 402 with rate limit errors. What are the three immediate diagnostic steps we should take?' },
  ];

  const benchmarkResults: BenchmarkRun[] = [];

  for (const m of models) {
    console.log(`\n--- Testing ${m.key} (${m.provider}:${m.model}) ---`);
    for (const tp of testPrompts) {
      const t0 = Date.now();
      try {
        const res = await llmChat({
          provider: m.provider,
          model: m.model,
          prompt: tp.prompt,
          systemPrompt: 'You are Jarvis, an advanced desktop operating assistant. Reply clearly, accurately, and concisely.',
          maxTokens: 1024,
        });
        const durationMs = Date.now() - t0;
        let toolValid: boolean | undefined = undefined;
        if (tp.name.includes('Tool Call')) {
          try {
            const parsed = JSON.parse(res.reply.replace(/```json\n?|\n?```/g, '').trim());
            toolValid = parsed.target === 'YouTube' || Boolean(parsed.url);
          } catch {
            toolValid = false;
          }
        }
        console.log(`  [${tp.name}] ${durationMs}ms | Reply (${res.reply.length} chars): "${res.reply.slice(0, 100).replace(/\n/g, ' ')}..."`);
        benchmarkResults.push({
          modelKey: m.key,
          provider: m.provider,
          model: m.model,
          prompt: tp.name,
          responseLatencyMs: durationMs,
          reply: res.reply,
          toolCallValid: toolValid,
        });
      } catch (err: any) {
        const durationMs = Date.now() - t0;
        console.error(`  [${tp.name}] FAILED in ${durationMs}ms:`, err?.message || err);
        benchmarkResults.push({
          modelKey: m.key,
          provider: m.provider,
          model: m.model,
          prompt: tp.name,
          responseLatencyMs: durationMs,
          reply: '',
          error: err?.message || String(err),
        });
      }
    }
  }

  return benchmarkResults;
}

async function runLiveAcceptance() {
  console.log('\n======================================================');
  console.log('PART 9 & 10: LIVE INSTALLED-RUNTIME ACCEPTANCE SUITE');
  console.log('======================================================\n');

  const testReport: { test: string; status: 'PASS' | 'FAIL'; evidence: any }[] = [];

  // 1. Voice Completeness & Natural Pause Handling
  console.log('[Test 1] Voice Utterance Completeness & Natural Pauses...');
  const incompleteUtterances = [
    'I want to',
    'Jarvis, please open the',
    'It is not',
    'Can you help me with',
    'Ich möchte bitte',
    'Weil wir',
  ];
  let voicePass = true;
  for (const text of incompleteUtterances) {
    const isComplete = isUtteranceComplete(text);
    const withPunct = isUtteranceComplete(`${text}.`);
    if (isComplete || withPunct) {
      voicePass = false;
      console.error(`  FAIL: Incomplete fragment "${text}" was classified as complete!`);
    }
  }

  // Concatenation test
  const contDec1 = decideContinuation('Jarvis, please open the', 'YouTube website.');
  const completeCombined = contDec1.action === 'submit' && contDec1.text.includes('YouTube');

  testReport.push({
    test: 'Voice Natural Pauses & Continuation Strategy',
    status: voicePass && completeCombined ? 'PASS' : 'FAIL',
    evidence: {
      incompleteFragmentsHeld: voicePass,
      concatenationResolved: contDec1,
    }
  });

  // 2. Runtime Identity Truth
  console.log('[Test 2] Runtime Identity Query ("What AI model are you running right now?")...');
  const routing = await getAuthoritativeRoutingInfo();
  const identityResp = await handleSystemIntrospection('MODEL', 'conv-test-id', {} as any);
  const identityTruth = identityResp.text.includes('xiaomi/mimo-v2.6-flash') || identityResp.text.includes(routing.configuredPrimaryModel);
  console.log(`  Spoken: "${identityResp.text}"`);

  testReport.push({
    test: 'Runtime Identity Truth ("What AI model are you running right now?")',
    status: identityTruth ? 'PASS' : 'FAIL',
    evidence: {
      spokenText: identityResp.text,
      configuredPrimary: routing.configuredPrimaryRoute,
      lastActualProvider: routing.lastActualProvider,
    }
  });

  // 3. Project Context ("Jarvis, go to Free Cash project and tell me status")
  console.log('[Test 3] Project Context ("Jarvis, go to the Free Cash project and tell me its status.")...');
  const allProjects = projectsStore.listProjects();
  const freeCashProject = allProjects.find((p: any) => /free\s*cash/i.test(p.name));
  const turnProj = await routeTurn({
    prompt: 'Jarvis, go to the Free Cash project and tell me its status.',
    conversationId: 'conv-test-proj',
  });
  const projPass = Boolean(freeCashProject) && Boolean(turnProj.text);
  console.log(`  Spoken: "${turnProj.text}"`);

  testReport.push({
    test: 'Project Context ("Go to Free Cash and tell status")',
    status: projPass ? 'PASS' : 'FAIL',
    evidence: {
      projectId: freeCashProject?.id,
      projectName: freeCashProject?.name,
      spokenText: turnProj.text,
      route: turnProj.route,
    }
  });

  // 4. External Action Truth & Browser Navigation
  console.log('[Test 4] Browser Navigation & Action Contract ("Jarvis, open Google." & "Jarvis, open YouTube.")...');
  const convBrowser = `conv-browser-${Date.now()}`;
  const navGoogle = await browserOperator.openTarget('Google', {
    conversationId: convBrowser,
    goalText: 'open Google',
    actionKind: 'navigate',
  });
  console.log(`  Google Navigation: success=${navGoogle.success}, verified=${navGoogle.verified}, url=${navGoogle.url}, spoken="${navGoogle.spokenText}"`);

  const navYouTube = await browserOperator.openTarget('YouTube', {
    conversationId: convBrowser,
    goalText: 'open YouTube',
    actionKind: 'navigate',
  });
  console.log(`  YouTube Navigation: success=${navYouTube.success}, verified=${navYouTube.verified}, url=${navYouTube.url}, spoken="${navYouTube.spokenText}"`);

  const browserNavPass = navGoogle.success && navGoogle.verified && navYouTube.success && navYouTube.verified;
  testReport.push({
    test: 'Browser Real Execution & Verification (Google + YouTube)',
    status: browserNavPass ? 'PASS' : 'FAIL',
    evidence: {
      google: { url: navGoogle.url, verified: navGoogle.verified, spoken: navGoogle.spokenText },
      youtube: { url: navYouTube.url, verified: navYouTube.verified, spoken: navYouTube.spokenText },
    }
  });

  // 5. Context Derivation ("What website did you just open?")
  console.log('[Test 5] Browser Context Derivation ("What website did you just open?")...');
  const snap = await browserOperator.inspect();
  const contextDerivationPass = Boolean(snap && snap.host && (snap.host.includes('youtube') || snap.host.includes('google')));
  console.log(`  Current active browser host: ${snap?.host || 'none'}`);

  testReport.push({
    test: 'Browser State Query ("What website did you just open?")',
    status: contextDerivationPass ? 'PASS' : 'FAIL',
    evidence: {
      observedHost: snap?.host,
      observedTitle: snap?.title,
      contentUsable: snap?.contentUsable,
    }
  });

  // 6. Forced Browser Action Failure (Never Hallucinate Success)
  console.log('[Test 6] Forced Browser Action Failure & Truthful Failure Report...');
  const failedNav = await browserOperator.openTarget('https://this-domain-definitely-does-not-exist-9876543210.invalid', {
    conversationId: `conv-fail-${Date.now()}`,
    goalText: 'open invalid',
    actionKind: 'navigate',
  });

  const failureTruthPass = (failedNav.success === false || failedNav.verified === false) &&
    !failedNav.spokenText.includes("I've opened");
  console.log(`  Failed Nav: success=${failedNav.success}, verified=${failedNav.verified}, spoken="${failedNav.spokenText}"`);

  testReport.push({
    test: 'Forced Browser Failure Contract (Truthful Error Reporting)',
    status: failureTruthPass ? 'PASS' : 'FAIL',
    evidence: {
      success: failedNav.success,
      verified: failedNav.verified,
      spokenText: failedNav.spokenText,
      error: failedNav.error,
    }
  });

  // 7. Conversational Correction Recovery ("No, you didn't open it.")
  console.log('[Test 7] Conversational Correction Recovery ("No, you did not open it")...');
  const correctionTurn = await universalExecutionController.handleUserTurn({
    prompt: "No, you didn't open it.",
    conversationId: convBrowser,
  });
  console.log(`  Correction response: "${correctionTurn.spokenText}"`);
  const correctionPass = Boolean(correctionTurn.handled) && !correctionTurn.spokenText.includes("I've opened");

  testReport.push({
    test: "Conversational Correction (\"No, you didn't open it.\")",
    status: correctionPass ? 'PASS' : 'FAIL',
    evidence: {
      spokenText: correctionTurn.spokenText,
      route: correctionTurn.route,
    }
  });

  // 8. Repeatability Cycles (3 cycles of multi-turn flow)
  console.log('[Test 8] Multi-Cycle Repeatability Check (3 cycles)...');
  let repPass = true;
  for (let c = 1; c <= 3; c++) {
    const cycleConv = `conv-cycle-${c}-${Date.now()}`;
    const tG = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, open Google.',
      conversationId: cycleConv,
    });
    const tM = await handleSystemIntrospection('MODEL', cycleConv, {} as any);
    if (!tG.handled || !tM.text) {
      repPass = false;
      console.error(`  Cycle ${c} failed!`);
    } else {
      console.log(`  Cycle ${c} PASSED.`);
    }
  }

  testReport.push({
    test: 'Multi-Cycle Repeatability & State Cleanliness',
    status: repPass ? 'PASS' : 'FAIL',
    evidence: { cyclesTested: 3, allPassed: repPass }
  });

  return testReport;
}

async function main() {
  console.log('=== STARTING COMPLETE JARVIS & MIMO 2.6 MISSION VERIFICATION ===');
  
  const benchmarks = await runBenchmark();
  const acceptance = await runLiveAcceptance();

  console.log('\n======================================================');
  console.log('FINAL ACCEPTANCE RESULTS:');
  console.log('======================================================');
  let allPass = true;
  for (const t of acceptance) {
    console.log(`[${t.status}] ${t.test}`);
    if (t.status === 'FAIL') allPass = false;
  }

  console.log(`\nOVERALL MISSION RESULT: ${allPass ? 'PASS' : 'FAIL'}`);
}

main().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
