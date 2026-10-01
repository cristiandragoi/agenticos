import fs from 'node:fs';

const BASE_URL = 'http://127.0.0.1:4600';

async function createConversation() {
  const res = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Live Physical Retest Verification' }),
  });
  const data = await res.json();
  return data.id;
}

async function runTurn(conversationId, prompt) {
  console.log(`\n======================================================`);
  console.log(`>>> EXECUTING TURN: "${prompt}"`);
  console.log(`======================================================`);

  const res = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`HTTP error ${res.status}:`, err);
    return { prompt, error: err };
  }

  const text = await res.text();
  const rawEvents = text.split('\n\n').filter(Boolean);
  const parsedEvents = [];
  let chunks = '';
  let intentEv = null;
  let actionStatusEv = null;
  let doneEv = null;
  let goalRunEv = null;

  for (const block of rawEvents) {
    const lines = block.split('\n');
    let eventType = 'message';
    let dataStr = '';
    for (const l of lines) {
      if (l.startsWith('event: ')) eventType = l.substring(7).trim();
      if (l.startsWith('data: ')) dataStr = l.substring(6).trim();
    }
    try {
      const parsedData = dataStr ? JSON.parse(dataStr) : null;
      parsedEvents.push({ event: eventType, data: parsedData });
      if (eventType === 'intent') intentEv = parsedData;
      if (eventType === 'action_status') actionStatusEv = parsedData;
      if (eventType === 'done') doneEv = parsedData;
      if (eventType === 'goal_run') goalRunEv = parsedData;
      if (eventType === 'chunk' && parsedData?.delta) chunks += parsedData.delta;
    } catch {
      parsedEvents.push({ event: eventType, raw: dataStr });
    }
  }

  const result = {
    prompt,
    intent: intentEv,
    actionStatus: actionStatusEv,
    goalRun: goalRunEv,
    spokenResponse: chunks || doneEv?.text,
    done: doneEv,
    eventCount: parsedEvents.length,
  };

  console.log('INTENT:', JSON.stringify(intentEv, null, 2));
  console.log('ACTION_STATUS:', JSON.stringify(actionStatusEv, null, 2));
  console.log('GOAL_RUN:', JSON.stringify(goalRunEv, null, 2));
  console.log('SPOKEN RESPONSE:', result.spokenResponse);
  return result;
}

async function main() {
  const convId = await createConversation();
  console.log('Created conversation:', convId);

  const prompts = [
    'Open Comet Perplexity.',
    'Read what is inside Hermes 1.',
    'What do you see on my screen?',
    'Take a screenshot.',
    'Open the camera.',
    'Can you see me?',
    'Describe me.',
  ];

  const traceLog = [];
  for (const prompt of prompts) {
    const r = await runTurn(convId, prompt);
    traceLog.push(r);
    // Brief pause between turns
    await new Promise((res) => setTimeout(res, 2000));
  }

  fs.writeFileSync('D:\\AgenticOS\\live_physical_trace_results.json', JSON.stringify(traceLog, null, 2));
  console.log('\nAll traces written to D:\\AgenticOS\\live_physical_trace_results.json');
}

main().catch(console.error);
