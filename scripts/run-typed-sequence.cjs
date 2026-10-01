const http = require('http');

const CONV_ID = 'conv-4dad5a5e-';
const PORT = 4600;

function sendTurn(prompt, inputChannel = 'typed') {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      prompt,
      inputChannel,
      operationId: `test-op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/jarvis/conversations/${CONV_ID}/message/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-input-source': inputChannel,
      },
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      let textChunks = [];
      let lastDone = null;
      let lastIntent = null;
      let realRouteTrace = null;

      res.on('data', (chunk) => {
        const str = chunk.toString();
        rawData += str;
        const lines = str.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) textChunks.push(parsed.text);
              if (parsed.chunk) textChunks.push(parsed.chunk);
              if (parsed.delta) textChunks.push(parsed.delta);
              if (parsed.reply) textChunks.push(parsed.reply);
              if (parsed.route) lastDone = parsed;
              if (parsed.type) lastIntent = parsed;
            } catch (e) {}
          }
        }
      });

      res.on('end', () => {
        resolve({
          prompt,
          status: res.statusCode,
          fullText: textChunks.join('').trim(),
          doneEvent: lastDone,
          intentEvent: lastIntent,
          rawOutputPreview: rawData.slice(0, 500),
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('=== STARTING 5-TURN CONVERSATION SEQUENCE ON INSTALLED APP ===');

  // Turn 1: Ask for FreeCash status without starting work
  console.log('\n[TURN 1] Prompt: "What is the status of Free Cash?"');
  const t1 = await sendTurn('What is the status of Free Cash?');
  console.log('Turn 1 HTTP Status:', t1.status);
  console.log('Turn 1 Full Response:', t1.fullText);
  console.log('Turn 1 Done Metadata:', JSON.stringify(t1.doneEvent));

  // Turn 2: Ask "How much is 2 plus 2?"
  console.log('\n[TURN 2] Prompt: "How much is 2 plus 2?"');
  const t2 = await sendTurn('How much is 2 plus 2?');
  console.log('Turn 2 HTTP Status:', t2.status);
  console.log('Turn 2 Full Response:', t2.fullText);
  console.log('Turn 2 Done Metadata:', JSON.stringify(t2.doneEvent));

  // Turn 3: Ask "What is the capital of France?"
  console.log('\n[TURN 3] Prompt: "What is the capital of France?"');
  const t3 = await sendTurn('What is the capital of France?');
  console.log('Turn 3 HTTP Status:', t3.status);
  console.log('Turn 3 Full Response:', t3.fullText);
  console.log('Turn 3 Done Metadata:', JSON.stringify(t3.doneEvent));

  // Turn 4: Ask "Can you stop speaking?"
  console.log('\n[TURN 4] Prompt: "Can you stop speaking?"');
  const t4 = await sendTurn('Can you stop speaking?');
  console.log('Turn 4 HTTP Status:', t4.status);
  console.log('Turn 4 Full Response:', JSON.stringify(t4.fullText));
  console.log('Turn 4 Done Metadata:', JSON.stringify(t4.doneEvent));

  // Turn 5: Ask what work is actually running
  console.log('\n[TURN 5] Prompt: "What work is actually running right now?"');
  const t5 = await sendTurn('What work is actually running right now?');
  console.log('Turn 5 HTTP Status:', t5.status);
  console.log('Turn 5 Full Response:', t5.fullText);
  console.log('Turn 5 Done Metadata:', JSON.stringify(t5.doneEvent));

  console.log('\n=== SEQUENCE COMPLETED ===');
}

main().catch(err => {
  console.error('Error executing sequence:', err);
  process.exit(1);
});
