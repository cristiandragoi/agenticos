import http from 'http';

async function requestJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 4600,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let resBody = '';
      res.on('data', (chunk) => { resBody += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        } catch {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sendStreamTurn(conversationId, prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ prompt });
    const req = http.request({
      hostname: 'localhost',
      port: 4600,
      path: `/api/jarvis/conversations/${conversationId}/message/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      const events = [];
      let currentEvent = 'message';
      res.on('data', (chunk) => {
        raw += chunk.toString();
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              events.push({ event: currentEvent, data: payload });
            } catch {}
          }
        }
      });
      res.on('end', () => {
        const spokenTokens = events
          .filter(e => e.event === 'chunk' && e.data?.delta)
          .map(e => e.data.delta)
          .join('');
        const intent = events.find(e => e.event === 'intent')?.data;
        const navigation = events.find(e => e.event === 'navigation')?.data;
        const actionStatus = events.find(e => e.event === 'action_status')?.data;
        const done = events.find(e => e.event === 'done')?.data;
        resolve({
          status: res.statusCode,
          spokenText: spokenTokens.trim(),
          intent,
          navigation,
          actionStatus,
          done,
          rawEvents: events,
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getElectronActiveUrl() {
  try {
    const cdpPagesRes = await fetch('http://127.0.0.1:9222/json/list');
    const pages = await cdpPagesRes.json();
    const appPage = pages.find(p => p.url && !p.url.startsWith('devtools://'));
    return appPage ? appPage.url : 'unknown';
  } catch (err) {
    return `CDP error: ${err.message}`;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('LIVE CONVERSATION ACCEPTANCE SUITE: BLOCKER CONTEXT & FOLLOW-UPS');
  console.log('Testing against installed AgenticOS on port 4600 + CDP on port 9222');
  console.log('========================================================================\n');

  // Verify health
  const health = await requestJson('GET', '/api/health');
  console.log('Server Health:', health.status, 'Build ID:', health.data?.build?.buildId);
  const electronUrl = await getElectronActiveUrl();
  console.log('Electron UI URL via CDP:', electronUrl);

  // 0. Create conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', { title: 'Blocker Follow-Up Suite' });
  const conversationId = convRes.data?.id || convRes.data?.conversationId;
  console.log(`Initialized Conversation ID: ${conversationId}`);
  const projectId = 'proj-free-cash';

  // ── STEP 1: Open Free Cash ──
  console.log('\n--- Turn 1: Open Free Cash. ---');
  const turn1 = await sendStreamTurn(conversationId, 'Open Free Cash.');
  console.log(`Intent: ${turn1.intent?.type}`);
  console.log(`Spoken: "${turn1.spokenText}"`);
  const pass1 = (turn1.intent?.type === 'navigation' || turn1.spokenText.includes('Free Cash')) && turn1.spokenText.length > 0;
  console.log(`PASS Step 1: ${pass1 ? 'PASS' : 'FAIL'}`);

  // ── STEP 2: Start operating inside Free Cash ──
  console.log('\n--- Turn 2: Start operating inside Free Cash. ---');
  const turn2 = await sendStreamTurn(conversationId, 'Start operating inside Free Cash.');
  console.log(`Intent: ${turn2.intent?.type}`);
  console.log(`Spoken: "${turn2.spokenText}"`);
  const pass2 = turn2.intent?.type === 'project_operate' && turn2.spokenText.length > 0;
  console.log(`PASS Step 2: ${pass2 ? 'PASS' : 'FAIL'}`);

  // ── STEP 3: What is blocked? ──
  console.log('\n--- Turn 3: What is blocked? ---');
  const turn3 = await sendStreamTurn(conversationId, 'What is blocked?');
  console.log(`Intent: ${turn3.intent?.type || turn3.done?.route}`);
  console.log(`Spoken: "${turn3.spokenText}"`);
  const pass3 = turn3.spokenText.includes('blocked') && turn3.spokenText.includes('Missing external FreeCash API keys / credentials');
  console.log(`PASS Step 3: ${pass3 ? 'PASS' : 'FAIL'}`);

  // ── STEP 4: Which one is missing the API keys? ──
  console.log('\n--- Turn 4: Which one is missing the API keys? ---');
  const turn4 = await sendStreamTurn(conversationId, 'Which one is missing the API keys?');
  console.log(`Intent: ${turn4.intent?.type || turn4.done?.route}`);
  console.log(`Spoken: "${turn4.spokenText}"`);
  const pass4 = (turn4.intent?.type === 'blocker_detail_read' || turn4.done?.route === 'blocker_detail_read') &&
    turn4.spokenText.includes('Free Cash: External Account Credential Setup') &&
    turn4.spokenText.includes('Missing external FreeCash API keys / credentials');
  console.log(`PASS Step 4: ${pass4 ? 'PASS' : 'FAIL'}`);

  // ── STEP 5: Which API keys exactly? ──
  console.log('\n--- Turn 5: Which API keys exactly? ---');
  const turn5 = await sendStreamTurn(conversationId, 'Which API keys exactly?');
  console.log(`Intent: ${turn5.intent?.type || turn5.done?.route}`);
  console.log(`Spoken: "${turn5.spokenText}"`);
  const pass5 = (turn5.intent?.type === 'blocker_detail_read' || turn5.done?.route === 'blocker_detail_read') &&
    turn5.spokenText.includes('Free Cash: External Account Credential Setup') &&
    turn5.spokenText.includes('does not currently specify which provider or API');
  console.log(`PASS Step 5: ${pass5 ? 'PASS' : 'FAIL'}`);

  // ── STEP 6: Why does it need them? ──
  console.log('\n--- Turn 6: Why does it need them? ---');
  const turn6 = await sendStreamTurn(conversationId, 'Why does it need them?');
  console.log(`Intent: ${turn6.intent?.type || turn6.done?.route}`);
  console.log(`Spoken: "${turn6.spokenText}"`);
  const pass6 = (turn6.intent?.type === 'blocker_detail_read' || turn6.done?.route === 'blocker_detail_read') &&
    turn6.spokenText.includes('Configure external FreeCash API credentials and account connectivity');
  console.log(`PASS Step 6: ${pass6 ? 'PASS' : 'FAIL'}`);

  // ── STEP 7: Can you resolve it? ──
  console.log('\n--- Turn 7: Can you resolve it? ---');
  const turn7 = await sendStreamTurn(conversationId, 'Can you resolve it?');
  console.log(`Intent: ${turn7.intent?.type || turn7.done?.route}`);
  console.log(`Spoken: "${turn7.spokenText}"`);
  const pass7 = (turn7.intent?.type === 'action' || turn7.done?.route === 'action') &&
    turn7.spokenText.includes('requires external FreeCash API keys or account credentials');
  console.log(`PASS Step 7: ${pass7 ? 'PASS' : 'FAIL'}`);

  // ── STEP 8: Natural language alias: Who needs the credentials? ──
  console.log('\n--- Turn 8: Who needs the credentials? ---');
  const turn8 = await sendStreamTurn(conversationId, 'Who needs the credentials?');
  console.log(`Intent: ${turn8.intent?.type || turn8.done?.route}`);
  console.log(`Spoken: "${turn8.spokenText}"`);
  const pass8 = turn8.spokenText.includes('Free Cash: External Account Credential Setup') && turn8.spokenText.length > 0;
  console.log(`PASS Step 8: ${pass8 ? 'PASS' : 'FAIL'}`);

  // ── STEP 9: Turn Invariant Check: Never silent / empty ──
  console.log('\n--- Turn 9: Turn invariant: What exactly is missing? ---');
  const turn9 = await sendStreamTurn(conversationId, 'What exactly is missing?');
  console.log(`Intent: ${turn9.intent?.type || turn9.done?.route}`);
  console.log(`Spoken: "${turn9.spokenText}"`);
  const pass9 = turn9.spokenText.trim().length > 0 && !turn9.spokenText.includes('No matching task exists.');
  console.log(`PASS Step 9: ${pass9 ? 'PASS' : 'FAIL'}`);

  // Clean up: Stop operations
  await sendStreamTurn(conversationId, 'Stop working on Free Cash.');

  console.log('\n========================================================================');
  console.log('SUMMARY OF RESULTS:');
  console.log(`1. Open Free Cash.:                        ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log(`2. Start operating inside Free Cash.:       ${pass2 ? 'PASS' : 'FAIL'}`);
  console.log(`3. What is blocked?:                        ${pass3 ? 'PASS' : 'FAIL'}`);
  console.log(`4. Which one is missing the API keys?:      ${pass4 ? 'PASS' : 'FAIL'}`);
  console.log(`5. Which API keys exactly?:                 ${pass5 ? 'PASS' : 'FAIL'}`);
  console.log(`6. Why does it need them?:                  ${pass6 ? 'PASS' : 'FAIL'}`);
  console.log(`7. Can you resolve it?:                     ${pass7 ? 'PASS' : 'FAIL'}`);
  console.log(`8. Who needs the credentials?:              ${pass8 ? 'PASS' : 'FAIL'}`);
  console.log(`9. Invariant (Never silent):                ${pass9 ? 'PASS' : 'FAIL'}`);
  console.log('========================================================================');

  const allPass = pass1 && pass2 && pass3 && pass4 && pass5 && pass6 && pass7 && pass8 && pass9;
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
