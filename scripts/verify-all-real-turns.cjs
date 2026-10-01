const http = require('http');

async function main() {
  const pagesRes = await fetch('http://localhost:9222/json');
  const pages = await pagesRes.json();
  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No Electron page found on port 9222');

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

  const healthRes = await fetch('http://localhost:4600/api/health');
  const health = await healthRes.json();

  const convRes = await fetch('http://localhost:4600/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const conv = await convRes.json();
  const conversationId = conv.id;

  const testCases = [
    { name: 'Find Free Cash project', prompt: 'Find the Free Cash project.' },
    { name: 'Open Free Cash', prompt: 'Open the Free Cash project so I can see it.' },
    { name: 'Open Revenue Operator', prompt: 'Open Revenue Operator.' },
    { name: 'Show Free Cash again', prompt: 'Show Free Cash again.' },
    { name: 'Correct failed navigation', prompt: "No, it didn't open. Open it again." },
    { name: 'Read-only code delegation', prompt: 'Where in the code is Revenue Operator implemented?' },
  ];

  const results = [];

  for (const tc of testCases) {
    const routeBefore = await evalInWindow(`window.location.hash || window.location.pathname`);

    const streamRes = await fetch(`http://localhost:4600/api/jarvis/conversations/${conversationId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: tc.prompt })
    });

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let turnRoute = null;
    let entityId = null;
    let entityType = null;
    let spokenText = '';
    let navTarget = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.route) turnRoute = data.route;
            if (data.entityId) entityId = data.entityId;
            if (data.entityType) entityType = data.entityType;
            if (data.target) navTarget = data.target;
            if (data.delta) spokenText += data.delta;
          } catch {}
        }
      }
    }

    let uiChanged = false;
    let routeAfter = routeBefore;

    if (navTarget) {
      await evalInWindow(`window.location.hash = '#${navTarget}'`);
      await new Promise(r => setTimeout(r, 600));
      routeAfter = await evalInWindow(`window.location.hash || window.location.pathname`);
      uiChanged = routeAfter !== routeBefore;
    }

    results.push({
      command: tc.name,
      prompt: tc.prompt,
      turnRoute,
      entityId,
      entityType,
      navTarget,
      routeBefore,
      routeAfter,
      uiChanged,
      spokenText,
      pass: tc.name.includes('Find') ? (entityId === 'proj-free-cash' && !spokenText.includes('revenue_opportunity'))
            : tc.name.includes('code') ? (!spokenText.includes('critical') && spokenText.includes('CodeX'))
            : (navTarget !== null && spokenText.includes('is open'))
    });
  }

  console.log('RESULTS_JSON:' + JSON.stringify({
    backendBuildId: health.buildId,
    frontendBuildId: await evalInWindow(`window.__JARVIS_BUILD_ID`),
    conversationId,
    results
  }));

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
