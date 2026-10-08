// @ts-check

const BASE_URL = 'http://127.0.0.1:4600';
const TOKEN = process.env.AGENTOS_API_TOKEN || '';

async function sendTurn(conversationId, prompt) {
  console.log(`\n========================================`);
  console.log(`>>> USER: "${prompt}"`);
  console.log(`========================================`);

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

  console.log(`<<< JARVIS: "${fullText.trim()}"`);
  if (donePayload) {
    console.log(`[Turn Meta]: route=${donePayload.route || donePayload.category}, outcome=${donePayload.outcome}`);
  }
  return fullText.trim();
}

async function run() {
  console.log('--- Starting Live Jarvis Verification on Running App ---');

  // 1. Create a fresh conversation
  const convRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: 'Live Verification German & Email' })
  });
  const { id: conversationId } = await convRes.json();
  console.log(`Created conversation: ${conversationId}`);

  // Test Turn 1: Switch to German
  const reply1 = await sendTurn(conversationId, 'Sprich Deutsch');

  // Check TTS status for this conversation
  const statusRes = await fetch(`${BASE_URL}/api/voice/tts/status?conversationId=${conversationId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  const ttsStatus = await statusRes.json();
  console.log('[Voice Status Check]:', {
    activeLanguage: ttsStatus.activeLanguage,
    effectiveVoice: ttsStatus.effectiveVoice,
    effectiveProvider: ttsStatus.effectiveProvider,
    locale: ttsStatus.locale
  });

  // Test Turn 2: Spoken German Turn 2
  const reply2 = await sendTurn(conversationId, 'Wer bist du und wie kannst du mir helfen?');

  // Test Turn 3: Spoken German Turn 3
  const reply3 = await sendTurn(conversationId, 'Welche Aufgaben kannst du heute für mich übernehmen?');

  // Test Turn 4: Email - Open my email
  const reply4 = await sendTurn(conversationId, 'Open my email');

  // Test Turn 5: Email - Write an email
  const reply5 = await sendTurn(conversationId, 'Write an email to Christian about Project Update saying All systems operational');

  // Test Turn 6: Email - Send it (review)
  const reply6 = await sendTurn(conversationId, 'Send it');

  // Test Turn 7: Email - Confirm send ('yes')
  const reply7 = await sendTurn(conversationId, 'yes');

  // Test TTS audio synthesis endpoint with German Deepgram model
  console.log(`\n========================================`);
  console.log(`>>> Testing German TTS Synthesis (/api/voice/tts)`);
  console.log(`========================================`);
  const ttsRes = await fetch(`${BASE_URL}/api/voice/tts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: 'Guten Tag! Ich bin Jarvis und stehe Ihnen jederzeit zur Verfügung.',
      language: 'de',
      voice: 'aura-2-charlotte-de'
    })
  });
  console.log(`TTS Response status: ${ttsRes.status}, Content-Type: ${ttsRes.headers.get('content-type')}`);
  const audioBuffer = await ttsRes.arrayBuffer();
  console.log(`Synthesized audio size: ${audioBuffer.byteLength} bytes`);

  console.log('\n--- Live Verification Complete ---');
}

run().catch(err => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
