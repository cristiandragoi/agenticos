/**
 * diag-live-jarvis.mjs  (v2 — correct endpoint)
 *
 * Live end-to-end diagnostic for Jarvis pipeline.
 * - Creates a fresh conversation
 * - Sends each test prompt via POST /api/jarvis/conversations/:id/message/stream
 * - Records every SSE event (intent, chunk, done, error, status, thinking)
 * - Probes TTS separately via POST /api/voice/tts
 * - Probes workspace, provider and assignment routes
 */
import http from 'http';

const BASE_HOST = '127.0.0.1';
const BASE_PORT = 4600;

// ── Colour helpers ──────────────────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', cyan:'\x1b[36m', magenta:'\x1b[35m', dim:'\x1b[2m' };
const c = (col, s) => `${C[col]}${s}${C.reset}`;

// ── REST helper ─────────────────────────────────────────────────────────────
function rest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: BASE_HOST, port: BASE_PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    let data = '';
    const req = http.request(options, res => {
      res.setEncoding('utf8');
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── SSE streaming fetch ─────────────────────────────────────────────────────
function sseStream(path, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: BASE_HOST, port: BASE_PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'text/event-stream',
      },
    };
    const events = [];
    let buffer = '';
    const req = http.request(options, res => {
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ events, timedOut: true, statusCode: res.statusCode });
      }, timeoutMs);

      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let eventType = '';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event: '))      { eventType = line.slice(7).trim(); }
          else if (line.startsWith('data: '))  { dataLine  = line.slice(6).trim(); }
          else if (line === '' && dataLine) {
            try { events.push({ type: eventType, data: JSON.parse(dataLine) }); }
            catch { events.push({ type: eventType, data: dataLine }); }
            eventType = ''; dataLine = '';
          }
        }
      });
      res.on('end', () => { clearTimeout(timer); resolve({ events, timedOut: false, statusCode: res.statusCode }); });
      res.on('error', err => { clearTimeout(timer); reject(err); });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Summarise SSE event stream ──────────────────────────────────────────────
function summarise(label, text, result) {
  const { events, timedOut, statusCode } = result;
  const intent    = events.find(e => e.type === 'intent')?.data ?? null;
  const chunks    = events.filter(e => e.type === 'chunk').map(e => e.data?.delta ?? '');
  const done      = events.find(e => e.type === 'done')?.data ?? null;
  const error_ev  = events.find(e => e.type === 'error')?.data ?? null;
  const status_ev = events.find(e => e.type === 'status')?.data ?? null;
  const fullReply = chunks.join('');

  console.log('\n' + c('bold', '═'.repeat(72)));
  console.log(c('bold', `TEST: ${label}`));
  console.log(c('dim',  `Transcript: "${text}"`));
  console.log(c('bold', '─'.repeat(72)));
  console.log(c('cyan', `HTTP status : ${statusCode}  TimedOut: ${timedOut}`));
  console.log(c('cyan', `Event count : ${events.length}`));

  if (intent) {
    console.log(c('yellow', `Intent type  : ${intent.type}`));
    console.log(c('yellow', `Intent route : ${intent.route}`));
    console.log(c('yellow', `Mode         : ${intent.mode}`));
    console.log(c('yellow', `Confidence   : ${intent.confidence}`));
    if (intent.reason)      console.log(c('yellow', `Reason       : ${intent.reason}`));
    if (intent.language)    console.log(c('yellow', `Language     : ${intent.language}`));
    if (intent.worker)      console.log(c('yellow', `Worker       : ${intent.worker}`));
    if (intent.pipeline)    console.log(c('yellow', `Pipeline     : ${intent.pipeline}`));
    if (intent.operationId) console.log(c('dim',    `OperationId  : ${intent.operationId}`));
  } else {
    console.log(c('red', 'Intent : (no intent event)'));
  }

  if (done) {
    console.log(c('green', `Provider     : ${done.provider ?? '(unset)'}`));
    console.log(c('green', `Model        : ${done.model ?? '(unset)'}`));
    console.log(c('green', `Route (done) : ${done.route ?? '(unset)'}`));
    console.log(c('green', `TotalMs      : ${done.totalMs ?? '(unset)'}`));
    console.log(c('green', `Status       : ${done.status ?? '(unset)'}`));
    if (done.language)   console.log(c('green', `Lang (done)  : ${done.language}`));
    if (done.taskId)     console.log(c('green', `TaskId       : ${done.taskId}`));
    if (done.firstTokenMs !== undefined) console.log(c('green', `FirstTokenMs : ${done.firstTokenMs}`));
  }

  if (status_ev) {
    console.log(c('magenta', `Status event : state=${status_ev.state} provider=${status_ev.provider} model=${status_ev.model}`));
  }

  if (error_ev) {
    console.log(c('red', `ERROR event  : ${JSON.stringify(error_ev)}`));
  }

  console.log(c('bold', `\nFull reply (${fullReply.length} chars):`));
  console.log(fullReply.trim() || c('red', '(empty)'));

  console.log(c('dim', `\nAll events:`));
  for (const e of events) {
    const compact = JSON.stringify(e.data).slice(0, 100);
    console.log(c('dim', `  [${(e.type||'?').padEnd(10)}] ${compact}`));
  }
  return { label, text, intent, done, error: error_ev, fullReply, events, statusCode, timedOut };
}

// ── TTS diagnostic ──────────────────────────────────────────────────────────
async function probeTts(text, language, convId) {
  console.log(c('cyan', `\n[TTS Probe] lang=${language} text="${text.slice(0,50)}"`));
  const result = await rest('POST', '/api/voice/tts', { text, language, agentId: 'agent-jarvis', conversationId: convId });
  const b = result.body;
  if (b && b.provider) {
    const ok = c('green', '✓');
    console.log(`  ${ok} Provider    : ${b.provider}`);
    console.log(`  ${ok} Voice       : ${b.voice}`);
    console.log(`  ${ok} Format      : ${b.format}`);
    console.log(`  ${ok} SizeBytes   : ${b.sizeBytes}`);
    console.log(`  ${ok} Language    : ${b.language}`);
    if (b.fallbackReason) console.log(`  ${c('yellow','!')} Fallback    : ${b.fallbackReason}`);
  } else {
    console.log(c('red', `  TTS FAIL: ${JSON.stringify(b).slice(0,200)}`));
  }
  return b;
}

// ── Create conversation ──────────────────────────────────────────────────────
async function createConversation(title) {
  const r = await rest('POST', '/api/jarvis/conversations', { title });
  if (r.status >= 200 && r.status < 300 && r.body.id) return r.body.id;
  // If POST creates with auto-ID, pick the first existing one
  const g = await rest('GET', '/api/jarvis/conversations');
  const list = Array.isArray(g.body) ? g.body : (g.body?.conversations ?? []);
  if (list.length > 0) return list[0].id;
  throw new Error(`Cannot create or find conversation: ${JSON.stringify(r.body)}`);
}

// ── Send one turn ───────────────────────────────────────────────────────────
async function sendTurn(convId, prompt, extra = {}) {
  return sseStream(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    inputChannel: 'text',
    ...extra,
  }, 90000);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(c('bold', '\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(c('bold',   '║       JARVIS LIVE END-TO-END DIAGNOSTIC  v2                  ║'));
  console.log(c('bold',   '╚══════════════════════════════════════════════════════════════╝'));
  console.log(c('dim', `Time: ${new Date().toISOString()}`));

  // ── Pre-flight ──
  console.log(c('bold', '\n── Pre-flight ────────────────────────────────────────────────'));

  // Health
  const health = await rest('GET', '/api/health');
  console.log(c('cyan', `Health      : ${health.body.status} v${health.body.version}`));

  // Workspace
  const ws = await rest('GET', '/api/workspace/current');
  console.log(c('cyan', `Workspace   : ${JSON.stringify(ws.body)}`));

  // Providers  (show only enabled/connected ones)
  const provR = await rest('GET', '/api/providers');
  const providers = Array.isArray(provR.body) ? provR.body : [];
  const connected = providers.filter(p => p.status === 'connected' || p.status === 'active');
  console.log(c('cyan', `Providers   : ${providers.length} total, ${connected.length} connected: ${connected.map(p => p.id || p.name).join(', ')}`));

  // Runtime diagnostics (get active model)
  const rdR = await rest('GET', '/api/diagnostics/runtime');
  console.log(c('cyan', `RuntimeDiag : ${JSON.stringify(rdR.body).slice(0,200)}`));

  // Agent assignments
  const agentsR = await rest('GET', '/api/agents');
  const agents = Array.isArray(agentsR.body) ? agentsR.body : [];
  const jarvisAgent = agents.find(a => a.id === 'agent-jarvis' || a.slug === 'jarvis');
  console.log(c('cyan', `Jarvis agent: ${JSON.stringify(jarvisAgent ?? 'not found').slice(0,150)}`));

  // Routing ledger
  const ledgerR = await rest('GET', '/api/routing/ledger');
  console.log(c('cyan', `Routing ledger entries: ${Array.isArray(ledgerR.body) ? ledgerR.body.length : 'n/a'}`));

  // Create diag conversation
  const convId = await createConversation('Live Diagnostic Session');
  console.log(c('cyan', `ConvId      : ${convId}`));

  const results = [];

  // ══════════════════════════════════════════════════════════════════════════
  // TEST A — Local status check (must use investigation, not LLM guessing)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const text = 'Check the local status of AgenticOS, Hermes, and Codex. Do not search the web.';
    console.log(c('bold', '\n[Running Test A...]'));
    const r = await sendTurn(convId, text, { inputChannel: 'text' });
    results.push(summarise('A: Local AgenticOS status check', text, r));
  }

  await new Promise(r => setTimeout(r, 1500));

  // ══════════════════════════════════════════════════════════════════════════
  // TEST B — Language switch (must be deterministic BEFORE supervisor_v2)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const text = 'Jarvis, switch to German.';
    console.log(c('bold', '\n[Running Test B...]'));
    const r = await sendTurn(convId, text, { inputChannel: 'voice', language: 'en' });
    results.push(summarise('B: Language switch to German', text, r));
  }

  // TTS probe — English
  const ttsEn = await probeTts('The system is online and ready.', 'en', convId);

  // TTS probe — German (after language switch)
  const ttsDe = await probeTts('Guten Morgen, ich bin bereit für Ihre Befehle.', 'de', convId);

  await new Promise(r => setTimeout(r, 1000));

  // ══════════════════════════════════════════════════════════════════════════
  // TEST C — German local status
  // ══════════════════════════════════════════════════════════════════════════
  {
    const text = 'Prüfe lokal den Status von AgenticOS.';
    console.log(c('bold', '\n[Running Test C...]'));
    const r = await sendTurn(convId, text, { inputChannel: 'voice', language: 'de' });
    results.push(summarise('C: German local status check', text, r));
  }

  await new Promise(r => setTimeout(r, 1000));

  // ══════════════════════════════════════════════════════════════════════════
  // TEST D — "Jarvis, stop" (client-side control — if it hits server, must be fast)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const text = 'Jarvis, stop.';
    console.log(c('bold', '\n[Running Test D...]'));
    const t0 = Date.now();
    const r = await sendTurn(convId, text, { inputChannel: 'voice' });
    const elapsed = Date.now() - t0;
    console.log(c('cyan', `  Elapsed: ${elapsed}ms`));
    results.push({ ...summarise('D: Stop command server-side', text, r), elapsed });
  }

  await new Promise(r => setTimeout(r, 1000));

  // ══════════════════════════════════════════════════════════════════════════
  // TEST E — Repository path analysis (must use D:\AgenticOS real path)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const text = 'Analyze D:\\AgenticOS read-only and report git status.';
    console.log(c('bold', '\n[Running Test E...]'));
    const r = await sendTurn(convId, text, { inputChannel: 'text' });
    results.push(summarise('E: Repository git status analysis', text, r));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n' + c('bold', '═'.repeat(72)));
  console.log(c('bold', 'DIAGNOSTIC VERDICT'));
  console.log(c('bold', '─'.repeat(72)));

  // Check: what provider/model actually served each turn?
  console.log(c('bold', '\nActual provider/model per turn:'));
  for (const r of results) {
    const p = r.done?.provider ?? 'N/A';
    const m = r.done?.model   ?? 'N/A';
    const col = p === 'agentic-os' ? 'dim' : (p !== 'N/A' ? 'green' : 'red');
    console.log(`  ${c(col, r.label)}`);
    console.log(`    provider=${p}  model=${m}  route=${r.done?.route ?? 'N/A'}  totalMs=${r.done?.totalMs ?? 'N/A'}`);
  }

  // Check: is V2 supervisor active?
  const v2Active = results.some(r => r.intent?.pipeline === 'JARVIS SUPERVISOR V2' || r.intent?.mode === 'conversational_supervisor');
  console.log(c(v2Active ? 'green' : 'red', `\nSupervisor V2 active: ${v2Active}`));

  // Check: language switch deterministic?
  const langSwitch = results[1];
  const langDet = langSwitch?.intent?.type === 'language_preference' && langSwitch?.done?.provider === 'agentic-os';
  console.log(c(langDet ? 'green' : 'red', `Language switch deterministic: ${langDet}`));
  if (!langDet) console.log(c('red', `  → type=${langSwitch?.intent?.type} provider=${langSwitch?.done?.provider}`));

  // Check: TTS provider for German
  const deProvider = ttsDe?.provider ?? 'N/A';
  const deVoice = ttsDe?.voice ?? 'N/A';
  const piperUsed = deProvider === 'piper';
  console.log(c(piperUsed ? 'green' : 'red', `German TTS provider: ${deProvider} voice: ${deVoice}`));
  if (!piperUsed) console.log(c('yellow', `  → Edge-TTS fallback used (Piper not available or /speak endpoint has no Piper block)`));

  // Check: Stop command fast?
  const stopR = results[3];
  const stopFast = (stopR?.elapsed ?? 99999) < 3000 || (stopR?.events?.length ?? 99) <= 4;
  console.log(c(stopFast ? 'green' : 'red', `Stop command fast/local: ${stopFast}  elapsed=${stopR?.elapsed}ms events=${stopR?.events?.length}`));

  // Check: workspace path correct?
  const wsPath = ws.body?.workspaceRoot ?? '';
  const wsCorrect = /^D:\\AgenticOS/i.test(wsPath) || /^D:\/AgenticOS/i.test(wsPath);
  console.log(c(wsCorrect ? 'green' : 'red', `Workspace path correct: ${wsCorrect}  path=${wsPath}`));

  // Check: repo path in test E response
  const eReply = results[4]?.fullReply ?? '';
  const eHasPath = /D:\\?AgenticOS|D:\/AgenticOS/i.test(eReply);
  console.log(c(eHasPath ? 'green' : 'red', `Test E mentions D:\\AgenticOS: ${eHasPath}`));
  if (!eHasPath && eReply.length > 0) {
    console.log(c('dim', `  First 200 chars of E: "${eReply.slice(0,200)}"`));
  }

  // Check: hardcoded model name in reply?
  for (const r of results) {
    if (/qwen2\.5:7b/i.test(r.fullReply)) {
      console.log(c('red', `⚠ HARDCODED model name "qwen2.5:7b" appeared in reply for: ${r.label}`));
      console.log(c('dim', `  Context: "${r.fullReply.match(/.{0,40}qwen2\.5:7b.{0,40}/i)?.[0]}"`));
    }
  }

  // Check: generic vs. grounded answer for A
  const aReply = results[0]?.fullReply ?? '';
  const aIsGrounded = /online|unreachable|gateway|port|probe|latency|ms|ollama|hermes|codex/i.test(aReply);
  console.log(c(aIsGrounded ? 'green' : 'red', `Test A grounded (has live evidence): ${aIsGrounded}`));
  if (!aIsGrounded) {
    console.log(c('dim', `  First 200 chars: "${aReply.slice(0,200)}"`));
  }

  // Write evidence JSON
  const { writeFileSync } = await import('fs');
  const evidence = {
    timestamp: new Date().toISOString(),
    convId,
    workspace: ws.body,
    providers: connected.map(p => ({ id: p.id, name: p.name, status: p.status })),
    tts: { en: { provider: ttsEn?.provider, voice: ttsEn?.voice }, de: { provider: ttsDe?.provider, voice: ttsDe?.voice, fallbackReason: ttsDe?.fallbackReason } },
    results: results.map(r => ({
      label: r.label, text: r.text,
      intent: r.intent, done: r.done, error: r.error,
      fullReply: r.fullReply?.slice(0, 800),
      eventCount: r.events?.length,
      statusCode: r.statusCode,
      elapsed: r.elapsed,
    })),
  };
  writeFileSync('D:/AgenticOS/scripts/diag-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(c('dim', '\nEvidence → D:/AgenticOS/scripts/diag-evidence.json'));
}

main().catch(err => {
  console.error('\x1b[31mFATAL:\x1b[0m', err.message ?? err);
  process.exitCode = 1;
});
