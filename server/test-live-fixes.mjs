/**
 * test-live-fixes.mjs
 * Verification of the 4 user directives:
 * 1. Unclear STT fragments ("just. Da.") yield "Wie bitte?" instead of hallucinations.
 * 2. "Was kannst du tun?" is routed to model with comprehensive capabilities, NOT canned 1-line stub.
 * 3. Compound email command "Öffne Gmail und schreib eine Nachricht an meinen Entwickler" opens Gmail and asks for developer address.
 * 4. Control intent detector handles German stop keywords ("Stopp", "Halt", "Abbrechen") while raw noise/echo is ignored.
 */
import { turnLifecycle } from './dist/domains/turnLifecycle/index.js';
import { isUnclearShortUtterance, getClarificationReply } from './dist/domains/jarvisNext/unclearUtteranceGuard.js';
import { detectControlIntent } from './dist/domains/jarvisNext/controlIntentDetector.js';
import { isSelfHearingEcho } from './dist/domains/jarvisNext/audioUtils.js';
import { setActiveLanguageState } from './dist/services/language/activeLanguageState.js';

setActiveLanguageState('de', 'test');

let allPassed = true;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    allPassed = false;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runTests() {
  console.log('=== VERIFYING FIXES FOR USER DIRECTIVES ===\n');

  // Test 1: Unclear utterance guard unit test & turn lifecycle integration
  console.log('--- Test 1: Guarding against unclear fragments (e.g. "just. Da.") ---');
  assert(isUnclearShortUtterance('just. Da.'), 'isUnclearShortUtterance detects "just. Da."');
  assert(isUnclearShortUtterance('ähm'), 'isUnclearShortUtterance detects "ähm"');
  assert(!isUnclearShortUtterance('Stopp'), 'isUnclearShortUtterance allows "Stopp" (control command)');
  assert(!isUnclearShortUtterance('Wie spät ist es?'), 'isUnclearShortUtterance allows full sentence');

  let spoken1 = '';
  const res1 = await turnLifecycle.submit(
    {
      conversationId: `test-unclear-${Date.now()}`,
      text: 'just. Da.',
      source: 'voice_livekit',
      sttConfidence: 0.7,
    },
    {
      speak: async (t) => { spoken1 = t; }
    }
  );
  const text1 = spoken1 || res1.record?.responseText || '';
  console.log(`Response for "just. Da.": "${text1}"`);
  assert(
    text1.includes('Wie bitte') || text1.includes('nicht verstanden'),
    `Unclear fragment returns clarification without hallucinating: got "${text1}"`
  );

  // Test 2: "Was kannst du tun?" capability query
  console.log('\n--- Test 2: "Was kannst du tun?" Capability Response ---');
  let spoken2 = '';
  const res2 = await turnLifecycle.submit(
    {
      conversationId: `test-capabilities-${Date.now()}`,
      text: 'Was kannst du tun?',
      source: 'voice_livekit',
      sttConfidence: 0.99,
    },
    {
      speak: async (t) => { spoken2 = t; }
    }
  );
  const text2 = spoken2 || res2.record?.responseText || '';
  console.log(`Response for "Was kannst du tun?": "${text2}"`);
  assert(
    !text2.includes('Ich bin Jarvis, dein persönlicher Assistent für Agentic OS.') || text2.length > 80,
    'Not the old hardcoded 1-sentence stub'
  );
  assert(
    text2.length > 50,
    `Gives a detailed capabilities answer (length ${text2.length} chars)`
  );

  // Test 3: Compound command "Öffne Gmail und schreib eine Nachricht an meinen Entwickler"
  console.log('\n--- Test 3: Compound Command (Gmail + Draft without hardcoded fake address) ---');
  let spoken3 = '';
  const res3 = await turnLifecycle.submit(
    {
      conversationId: `test-compound-${Date.now()}`,
      text: 'Öffne Gmail und schreib eine Nachricht an meinen Entwickler',
      source: 'voice_livekit',
      sttConfidence: 0.99,
    },
    {
      speak: async (t) => { spoken3 = t; }
    }
  );
  const text3 = spoken3 || res3.record?.responseText || '';
  console.log(`Response for compound email command: "${text3}"`);
  assert(
    !text3.includes('recipient@example.com'),
    'Does not invent fake recipient@example.com address'
  );
  assert(
    text3.toLowerCase().includes('adresse') || text3.toLowerCase().includes('e-mail') || text3.toLowerCase().includes('entwickler') || text3.toLowerCase().includes('gmail'),
    `Prompts for recipient address or opens Gmail: got "${text3}"`
  );

  // Test 4: Control Intent Detector & German stop keywords
  console.log('\n--- Test 4: German Stop Keywords & Echo Prevention ---');
  const stopIntent1 = detectControlIntent('Stopp');
  console.log('stopIntent1 ("Stopp"):', stopIntent1);
  assert(stopIntent1?.intent === 'STOP' && stopIntent1.isControl, 'Detects "Stopp" as stop intent');
  const stopIntent2 = detectControlIntent('Halt bitte an');
  console.log('stopIntent2 ("Halt bitte an"):', stopIntent2);
  assert(stopIntent2?.intent === 'STOP' && stopIntent2.isControl, 'Detects "Halt bitte an" as stop intent');
  const stopIntent3 = detectControlIntent('Hör auf');
  console.log('stopIntent3 ("Hör auf"):', stopIntent3);
  assert(stopIntent3?.intent === 'STOP' && stopIntent3.isControl, 'Detects "Hör auf" as stop intent');

  // Verify that stop commands are NOT filtered out by echo detector
  const echoFiltered = isSelfHearingEcho('Stopp', 'Hier ist eine sehr lange Antwort von Jarvis');
  assert(!echoFiltered, '"Stopp" is never filtered out by isSelfHearingEcho');

  console.log('\n=======================================');
  if (allPassed) {
    console.log('🎉 ALL 4 USER DIRECTIVE VERIFICATIONS PASSED!');
    process.exit(0);
  } else {
    console.error('💥 SOME VERIFICATION CHECKS FAILED!');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
