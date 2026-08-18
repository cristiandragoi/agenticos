const WebSocket = require('ws');

async function run() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.error('No page target found');
    process.exit(1);
  }

  console.log('Connecting to WebSocket:', page.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await new Promise(r => ws.on('open', r));
  console.log('Connected to CDP!');

  // Navigate to Jarvis page: #/jarvis
  await send('Page.navigate', { url: 'file:///C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic%20OS/resources/app/dist/index.html#/jarvis' });
  await new Promise(r => setTimeout(r, 2000));

  // Evaluate DOM for goal card and result text
  const evalResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('[data-testid="jarvis-goal-card"]');
      const finalResult = document.querySelector('[data-testid="jarvis-goal-final-result"]');
      const copyBtn = document.querySelector('[aria-label="Copy Result"], [title="Copy Result"]');
      const allText = document.body.innerText;
      return {
        hasGoalCard: !!card,
        hasFinalResult: !!finalResult,
        hasCopyBtn: !!copyBtn,
        finalResultText: finalResult ? finalResult.innerText.slice(0, 300) : null,
        bodyExcerpt: allText.slice(0, 500)
      };
    })()`,
    returnByValue: true
  });

  console.log('DOM EVALUATION RESULT:', JSON.stringify(evalResult.result.value, null, 2));
  ws.close();
}

run().catch(console.error);
