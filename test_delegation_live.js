// Test 1: "Jarvis, delegate a read-only inspection of package.json to AntiGravity."
// Test 2: "Yeah, Jarvis, you can open Hermes 1, but you still cannot see or read what is inside the Hermes 1 window. Delegate this repair to AntiGravity. Keep the same task until the live Hermes 1 perception works and Argus verifies the actual window contents."

const testUtterance = process.argv[2] || "Jarvis, delegate a read-only inspection of package.json to AntiGravity.";

async function run() {
  console.log('--- LIVE TEST INITIATED ---');
  console.log('Utterance:', testUtterance);

  // 1. Create a fresh conversation
  const convRes = await fetch('http://127.0.0.1:4600/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Live Delegation Test' }),
  });
  const convData = await convRes.json();
  const convId = convData.id;
  console.log('Created conversation:', convId);

  // 2. Issue the prompt to the real Jarvis endpoint
  console.log('Sending message to /api/jarvis/conversations/' + convId + '/message/stream...');
  const res = await fetch(`http://127.0.0.1:4600/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: testUtterance }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let fullOutput = '';

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      const chunk = decoder.decode(value);
      fullOutput += chunk;
      process.stdout.write(chunk);
    }
  }

  console.log('\n--- STREAM COMPLETED ---');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
