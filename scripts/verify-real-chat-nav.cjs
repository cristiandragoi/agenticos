async function testChatNav() {
  const pagesRes = await fetch('http://localhost:9222/json');
  const pages = await pagesRes.json();
  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No page found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const evalInWindow = (expr) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        resolve(data.result?.result?.value);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true }
    }));
  });

  await new Promise(r => ws.onopen = r);

  console.log('Resetting route to mission-control...');
  await evalInWindow(`window.location.hash = '#/mission-control'`);
  await new Promise(r => setTimeout(r, 500));

  console.log('Route before test:', await evalInWindow(`window.location.hash`));

  // Find the composer input in the DOM or trigger the API directly
  const convRes = await fetch('http://localhost:4600/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const conv = await convRes.json();

  console.log('Triggering SSE navigation turn for conversation:', conv.id);

  // Send turn "I would like to see the Free Cash project."
  const streamRes = await fetch(`http://localhost:4600/api/jarvis/conversations/${conv.id}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'I would like to see the Free Cash project.' })
  });

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let navTarget = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data:')) {
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed.target) {
            navTarget = parsed.target;
            console.log('RECEIVED NAV TARGET FROM STREAM:', navTarget);
          }
        } catch {}
      }
    }
  }

  if (navTarget) {
    console.log('Navigating real window to target:', navTarget);
    await evalInWindow(`window.location.hash = '#${navTarget}'`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const finalHash = await evalInWindow(`window.location.hash`);
  console.log('FINAL ROUTE IN REAL WINDOW:', finalHash);

  ws.close();
  process.exit(finalHash.includes('proj-free-cash') ? 0 : 1);
}

testChatNav().catch(err => {
  console.error(err);
  process.exit(1);
});
