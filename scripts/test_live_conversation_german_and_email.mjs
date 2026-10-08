// @ts-check

const BASE_URL = 'http://127.0.0.1:4600';
const TOKEN = process.env.AGENTOS_API_TOKEN || '';

async function sendTurn(conversationId, prompt) {
  console.log(`\n========================================`);
  console.log(`>>> USER: "${prompt}"`);
  console.log(`========================================`);

  const startTime = Date.now();
  const response = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const raw = await response.text();
  const durationMs = Date.now() - startTime;
  const lines = raw.split('\n');
  let fullText = '';
  let donePayload = null;

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.delta) {
          fullText += parsed.delta;
        } else if (parsed.text) {
          fullText += parsed.text;
        } else if (parsed.content) {
          fullText += parsed.content;
        }
        if (parsed.route || parsed.outcome) {
          donePayload = parsed;
        }
      } catch (e) {
        // Not JSON
      }
    }
  }

  const reply = fullText.trim();
  console.log(`<<< JARVIS (${durationMs}ms): "${reply}"`);
  if (donePayload) {
    console.log(`[Turn Meta]: route=${donePayload.route || donePayload.category}, outcome=${donePayload.outcome}`);
  }
  return { reply, durationMs, donePayload };
}

async function run() {
  console.log('--- Starting Complete Live Jarvis German & Email Verification ---');

  // 1. Create a fresh conversation
  const convRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: 'Live Verification German & Gmail' })
  });
  const { id: conversationId } = await convRes.json();
  console.log(`Created conversation: ${conversationId}`);

  // Test Turn 1: "Hallo Jarvis"
  const turn1 = await sendTurn(conversationId, 'Hallo Jarvis');

  // Test Turn 2: Natural request for German: "Bitte auf Deutsch"
  const turn2 = await sendTurn(conversationId, 'Bitte auf Deutsch');

  // Check TTS status for this conversation
  const statusRes = await fetch(`${BASE_URL}/api/voice/tts/status?conversationId=${conversationId}&language=de`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  const ttsStatus = await statusRes.json();
  console.log('\n[Voice Status Check after German switch]:', {
    activeLanguage: ttsStatus.activeLanguage,
    effectiveVoice: ttsStatus.effectiveVoice,
    effectiveProvider: ttsStatus.effectiveProvider,
    locale: ttsStatus.locale,
    configured: ttsStatus.configured
  });

  // Verify voice is aura-2-julius-de
  if (ttsStatus.effectiveVoice !== 'aura-2-julius-de') {
    throw new Error(`Voice mismatch! Expected aura-2-julius-de but got ${ttsStatus.effectiveVoice}`);
  }

  // Test Turn 3: German Question 1
  const turn3 = await sendTurn(conversationId, 'Wer bist du und wie kannst du mir helfen?');

  // Test Turn 4: German Question 2
  const turn4 = await sendTurn(conversationId, 'Welche Aufgaben kannst du heute für mich übernehmen?');

  // Test Turn 5: German Question 3
  const turn5 = await sendTurn(conversationId, 'Was ist der aktuelle Status von AgenticOS?');

  // Test Turn 6: "open my Gmail"
  const turn6 = await sendTurn(conversationId, 'open my Gmail');

  // Verify TTS audio synthesis with the German Julius voice for one of the German responses
  console.log(`\n========================================`);
  console.log(`>>> Testing Synthesis of Turn 3 response with German Julius voice`);
  console.log(`========================================`);
  const ttsRes = await fetch(`${BASE_URL}/api/voice/tts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: turn3.reply.slice(0, 150),
      language: 'de',
      voice: 'aura-2-julius-de'
    })
  });
  const ttsJson = await ttsRes.json();
  console.log('[TTS Synthesis Result]:', {
    status: ttsRes.status,
    provider: ttsJson.provider,
    voice: ttsJson.voice,
    bytes: ttsJson.audioData ? Math.round(ttsJson.audioData.length * 0.75) : 0,
    error: ttsJson.error || null
  });

  if (ttsJson.voice !== 'aura-2-julius-de') {
    throw new Error(`Synthesized with wrong voice! Expected aura-2-julius-de, got ${ttsJson.voice}`);
  }

  console.log('\n========================================');
  console.log('--- SUMMARY OF RESULTS ---');
  console.log('========================================');
  console.log(`Turn 1 (Hallo Jarvis)            : ${turn1.durationMs}ms`);
  console.log(`Turn 2 (Bitte auf Deutsch)       : ${turn2.durationMs}ms`);
  console.log(`Turn 3 (German Q1)               : ${turn3.durationMs}ms`);
  console.log(`Turn 4 (German Q2)               : ${turn4.durationMs}ms`);
  console.log(`Turn 5 (German Q3)               : ${turn5.durationMs}ms`);
  console.log(`Turn 6 (open my Gmail)           : ${turn6.durationMs}ms`);
  console.log('Voice Provider & Model           :', ttsStatus.effectiveProvider, ttsStatus.effectiveVoice);
  console.log('All verification checks passed!');
}

run().catch(err => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
