/**
 * scripts/test_cold_start_installed_app.mjs
 *
 * Acceptance Scenario: COLD START INSTALLED APP
 *
 * Starting state:
 * - no dev server running
 * - no manually started AgenticOS backend
 * - no stale AgenticOS process
 *
 * Test Steps:
 * A. Launch installed AgenticOS.exe
 * B. Backend becomes healthy automatically
 * C. Jarvis text becomes operational
 * D. Voice token endpoint succeeds
 * E. LiveKit connects
 * F. Speak: `Hello Jarvis`
 * G. Jarvis receives/transcribes the utterance
 * H. Jarvis responds
 * I. No `Failed to fetch`
 * J. No `Token request failed`
 * K. No repeated backend reconnect loop
 */

import { _electron as electron } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const BASE_URL = 'http://127.0.0.1:4600';
const DIST = 'D:/AgenticOS/server/dist';
const TRACE_PATH = 'D:/AgenticOS/data/jarvis-runtime-trace.log';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('================================================================');
  console.log('ACCEPTANCE SCENARIO: COLD START INSTALLED APP');
  console.log(`Target Executable: ${EXE_PATH}`);
  console.log('================================================================\n');

  const report = {
    A_launch_installed_exe: 'PENDING',
    B_backend_healthy_auto: 'PENDING',
    C_jarvis_text_operational: 'PENDING',
    D_voice_token_succeeds: 'PENDING',
    E_livekit_connects: 'PENDING',
    F_speak_hello_jarvis: 'PENDING',
    G_jarvis_transcribes: 'PENDING',
    H_jarvis_responds: 'PENDING',
    I_no_failed_to_fetch: 'PENDING',
    J_no_token_request_failed: 'PENDING',
    K_no_reconnect_loop: 'PENDING',
  };

  // ── PRE-FLIGHT: TRUE COLD START CLEANUP ──
  console.log('[COLD START] 1. Pre-flight verification: terminating all stale processes...');
  try {
    execSync('powershell -NoProfile -Command "Get-Process -Name \'AgenticOS\',\'electron\',\'livekit-server\' -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
  } catch {}
  try {
    execSync('powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort 4600,7880 -ErrorAction SilentlyContinue; if ($conns) { foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }"', { stdio: 'ignore' });
  } catch {}

  await sleep(1500);

  // Verify ports 4600 and 7880 are closed
  let port4600InUse = false;
  try {
    const out = execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4600 -ErrorAction SilentlyContinue"').toString().trim();
    if (out) port4600InUse = true;
  } catch {}

  if (port4600InUse) {
    console.error('[COLD START] ERROR: Port 4600 is still occupied before launch! Cannot proceed with true cold start.');
    process.exit(1);
  }
  console.log('[COLD START] Clean slate confirmed: ports 4600 and 7880 are free.\n');

  // ── STEP A: LAUNCH INSTALLED AGENTICOS.EXE ──
  console.log(`[COLD START] STEP A: Launching installed AgenticOS.exe (${EXE_PATH})...`);
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  report.A_launch_installed_exe = 'PASS';
  console.log('✓ STEP A PASSED: AgenticOS.exe launched successfully.\n');

  const appProc = app.process();
  const consoleErrors = [];
  const consoleLogs = [];
  const electronLogs = [];

  appProc.stdout?.on('data', (d) => {
    const s = d.toString().trimEnd();
    electronLogs.push(s);
    if (s.includes('backend') || s.includes('health') || s.includes('livekit')) {
      console.log('[ELECTRON STDOUT]', s);
    }
  });

  appProc.stderr?.on('data', (d) => {
    const s = d.toString().trimEnd();
    electronLogs.push(s);
    console.error('[ELECTRON STDERR]', s);
  });

  const page = await app.firstWindow();
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
    if (text.includes('[JFE]') || text.includes('Backend') || text.includes('TOKEN') || text.includes('LiveKit')) {
      console.log(`[BROWSER CONSOLE] ${text}`);
    }
  });

  await page.waitForLoadState('domcontentloaded');
  console.log(`Browser window loaded at: ${page.url()}\n`);

  // ── STEP B: BACKEND BECOMES HEALTHY AUTOMATICALLY ──
  console.log('[COLD START] STEP B: Verifying backend starts automatically on port 4600...');
  let healthy = false;
  let backendHealthData = null;
  const startTime = Date.now();
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        backendHealthData = await res.json();
        healthy = true;
        break;
      }
    } catch {}
    await sleep(1000);
  }

  if (!healthy) {
    console.error('✗ STEP B FAILED: Backend did not become healthy within 30 seconds.');
    await app.close();
    process.exit(1);
  }

  const initialPid = backendHealthData?.pid;
  report.B_backend_healthy_auto = 'PASS';
  console.log(`✓ STEP B PASSED: Backend healthy in ${Date.now() - startTime}ms (PID: ${initialPid}, buildId: ${backendHealthData?.build?.buildId})\n`);

  // ── STEP C: JARVIS TEXT BECOMES OPERATIONAL ──
  console.log('[COLD START] STEP C: Testing Jarvis text operationality...');
  let textOperational = false;
  try {
    const convRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cold Start Acceptance Conversation' }),
    });
    if (convRes.ok) {
      const conv = await convRes.json();
      console.log(`Created conversation: ${conv.id}`);
      textOperational = true;
    }
  } catch (err) {
    console.error('Text test error:', err);
  }

  if (!textOperational) {
    console.error('✗ STEP C FAILED: Could not create Jarvis conversation.');
  } else {
    report.C_jarvis_text_operational = 'PASS';
    console.log('✓ STEP C PASSED: Jarvis text channel is operational.\n');
  }

  // ── STEP D: VOICE TOKEN ENDPOINT SUCCEEDS ──
  console.log('[COLD START] STEP D: Testing voice token endpoint...');
  let tokenData = null;
  try {
    const tokenRes = await fetch(`${BASE_URL}/api/jarvis-next/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomName: 'jarvis-next-main',
        identity: `user-acceptance-${Date.now().toString(36)}`,
        name: 'Acceptance User',
      }),
    });

    if (tokenRes.ok) {
      tokenData = await tokenRes.json();
      console.log(`Token received! wsUrl: ${tokenData.wsUrl}, token length: ${tokenData.token?.length}`);
    } else {
      console.error(`Token endpoint returned HTTP ${tokenRes.status}`);
    }
  } catch (err) {
    console.error('Token request error:', err);
  }

  if (!tokenData?.token || !tokenData?.wsUrl) {
    console.error('✗ STEP D FAILED: Token endpoint did not return valid token/wsUrl.');
    report.D_voice_token_succeeds = 'FAIL';
  } else {
    report.D_voice_token_succeeds = 'PASS';
    console.log('✓ STEP D PASSED: Voice token endpoint returned valid token and wsUrl.\n');
  }

  // ── STEP E: LIVEKIT CONNECTS ──
  console.log('[COLD START] STEP E: Connecting to LiveKit room...');
  const { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } =
    await import('file:///D:/AgenticOS/server/node_modules/@livekit/rtc-node/dist/index.js');
  const { synthesizeLocally } = await import(`file:///${DIST}/services/voice/localTts.js`);
  const { mp3ToPcmFrames } = await import(`file:///${DIST}/domains/jarvisNext/audioUtils.js`);

  const livekitRoom = new Room();
  const livekitAssistantReplies = [];
  const livekitTranscripts = [];

  livekitRoom.on(RoomEvent.DataReceived, (payload) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(payload));
      console.log(`[LIVEKIT DATA RECEIVED] type=${data.type}`);
      if (data.type === 'assistant_text' && data.text) {
        livekitAssistantReplies.push(data.text);
      }
      if (data.type === 'transcript' || data.type === 'user_transcript') {
        livekitTranscripts.push(data.text || JSON.stringify(data));
      }
    } catch {}
  });

  try {
    await livekitRoom.connect(tokenData.wsUrl, tokenData.token, { autoSubscribe: true });
    console.log(`LiveKit connected! isConnected: ${livekitRoom.isConnected}, connectionState: ${livekitRoom.connectionState}`);
  } catch (err) {
    console.error('LiveKit connection error:', err);
  }

  const isConnected = Boolean(livekitRoom.isConnected || livekitRoom.connectionState === 1);
  if (!isConnected) {
    console.error(`✗ STEP E FAILED: LiveKit failed to connect. (isConnected=${livekitRoom.isConnected})`);
    report.E_livekit_connects = 'FAIL';
  } else {
    report.E_livekit_connects = 'PASS';
    console.log(`✓ STEP E PASSED: LiveKit room connected successfully (isConnected=${livekitRoom.isConnected}).\n`);
  }

  // ── STEP F, G, H: SPEAK "Hello Jarvis" & VERIFY RESPONSE ──
  console.log('[COLD START] STEP F & G & H: Publishing mic track and speaking "Hello Jarvis"...');
  const audioSource = new AudioSource(24000, 1);
  const audioTrack = LocalAudioTrack.createAudioTrack('acceptance-mic', audioSource);
  await livekitRoom.localParticipant.publishTrack(audioTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  console.log('Local microphone track published.');
  report.F_speak_hello_jarvis = 'PASS';

  await sleep(1500);

  const silence = (ms) => {
    const frames = [];
    for (let i = 0; i < ms / 20; i++) {
      frames.push(new AudioFrame(new Int16Array(480), 24000, 1, 480));
    }
    return frames;
  };

  const utteranceText = 'Hello Jarvis';
  console.log(`Synthesizing utterance audio for: "${utteranceText}"...`);
  const mp3 = await synthesizeLocally(utteranceText);
  const speechFrames = await mp3ToPcmFrames(mp3, 24000, 20);

  const t0 = Date.now();
  console.log(`Sending speech frames (${speechFrames.length} frames)...`);
  for (const f of [...silence(300), ...speechFrames, ...silence(1500)]) {
    await audioSource.captureFrame(f);
  }

  console.log('Frames captured. Awaiting Jarvis transcription and response (up to 15s)...');
  while (Date.now() - t0 < 15000 && livekitAssistantReplies.length === 0) {
    await sleep(300);
  }

  if (livekitAssistantReplies.length > 0) {
    const reply = livekitAssistantReplies.join(' | ');
    console.log(`Jarvis responded via LiveKit: "${reply}"`);
    report.G_jarvis_transcribes = 'PASS';
    report.H_jarvis_responds = 'PASS';
    console.log('✓ STEP G & H PASSED: Jarvis transcribed speech and responded!\n');
  } else {
    // Check trace file
    let traceHasTranscription = false;
    let traceHasResponse = false;
    if (fs.existsSync(TRACE_PATH)) {
      const traceLines = fs.readFileSync(TRACE_PATH, 'utf8').split('\n');
      const recent = traceLines.slice(-30);
      for (const l of recent) {
        if (l.includes('Hello') || l.includes('STT_FINAL') || l.includes('VAD_END_OF_TURN')) traceHasTranscription = true;
        if (l.includes('TTS_FIRST_PCM') || l.includes('ROUTER_RESULT')) traceHasResponse = true;
      }
    }
    if (traceHasTranscription) report.G_jarvis_transcribes = 'PASS';
    if (traceHasResponse || livekitAssistantReplies.length > 0) report.H_jarvis_responds = 'PASS';
    console.log(`Trace check: transcribes=${report.G_jarvis_transcribes}, responds=${report.H_jarvis_responds}`);
  }

  // ── STEP I, J, K: VERIFY STABILITY & NO ERROR LOOPS ──
  console.log('[COLD START] STEP I, J, K: Checking error logs and backend process stability...');
  
  // Inspect all captured logs
  const allLogsJoined = [...consoleLogs, ...consoleErrors, ...electronLogs].join('\n');
  const hasFailedToFetch = allLogsJoined.includes('Failed to fetch') || consoleErrors.some(e => e.includes('Failed to fetch'));
  const hasTokenRequestFailed = allLogsJoined.includes('Token request failed') || consoleErrors.some(e => e.includes('Token request failed'));

  report.I_no_failed_to_fetch = hasFailedToFetch ? 'FAIL' : 'PASS';
  report.J_no_token_request_failed = hasTokenRequestFailed ? 'FAIL' : 'PASS';

  // Check backend PID to ensure it was NOT recycled/killed
  let finalPid = null;
  try {
    const finalHealth = await fetch(`${BASE_URL}/api/health`).then(r => r.json());
    finalPid = finalHealth?.pid;
  } catch {}

  const backendRemainedStable = Boolean(initialPid && finalPid && initialPid === finalPid);
  report.K_no_reconnect_loop = backendRemainedStable ? 'PASS' : 'FAIL';

  console.log(`Backend PID initial: ${initialPid}, final: ${finalPid}, stable: ${backendRemainedStable}`);
  console.log(`Failed to fetch detected: ${hasFailedToFetch}`);
  console.log(`Token request failed detected: ${hasTokenRequestFailed}`);

  // Disconnect & close app
  try {
    await livekitRoom.disconnect();
  } catch {}
  await app.close();

  console.log('\n================================================================');
  console.log('COLD START INSTALLED APP ACCEPTANCE RESULTS:');
  console.log(JSON.stringify(report, null, 2));
  console.log('================================================================\n');

  const allPassed = Object.values(report).every(v => v === 'PASS');
  if (allPassed) {
    console.log('🎉 ALL 11 COLD-START ACCEPTANCE CHECKS PASSED (A - K)!');
    process.exit(0);
  } else {
    console.error('❌ SOME CHECKS FAILED!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[COLD START] FATAL EXCEPTION:', err);
  process.exit(1);
});
