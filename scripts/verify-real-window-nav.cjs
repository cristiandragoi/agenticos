async function testRealWindow() {
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

  console.log('=== BEFORE NAVIGATION ===');
  const before = await evalInWindow(`JSON.stringify({
    href: window.location.href,
    hash: window.location.hash,
    buildId: window.__JARVIS_BUILD_ID
  })`);
  console.log('BEFORE:', before);

  console.log('\n=== DISPATCHING NAVIGATION IN REAL WINDOW ===');
  // Dispatch hash change / navigation via React Router in window
  await evalInWindow(`(() => {
    window.location.hash = '#/projects?project=proj-free-cash';
  })()`);

  // Wait 1 second for React to render
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n=== AFTER NAVIGATION ===');
  const after = await evalInWindow(`JSON.stringify({
    href: window.location.href,
    hash: window.location.hash,
    buildId: window.__JARVIS_BUILD_ID,
    bodySnippet: document.body.innerText.slice(0, 300).replace(/\\s+/g, ' ')
  })`);
  console.log('AFTER:', after);

  console.log('\n=== DISPATCHING REVENUE OPERATOR IN REAL WINDOW ===');
  await evalInWindow(`(() => {
    window.location.hash = '#/revenue-operator';
  })()`);
  await new Promise(r => setTimeout(r, 1000));

  const afterRev = await evalInWindow(`JSON.stringify({
    href: window.location.href,
    hash: window.location.hash,
    bodySnippet: document.body.innerText.slice(0, 300).replace(/\\s+/g, ' ')
  })`);
  console.log('AFTER REVENUE OPERATOR:', afterRev);

  ws.close();
  process.exit(0);
}

testRealWindow().catch(err => {
  console.error(err);
  process.exit(1);
});
