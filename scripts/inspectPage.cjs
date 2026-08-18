const WebSocket = require('ws');
(async () => {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.log('No page found');
    return;
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

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

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  };

  const hash = await evaluate('window.location.hash');
  console.log('Location hash:', hash);
  const composer = await evaluate('!!document.querySelector("[data-testid=\'codex-composer\']")');
  console.log('Composer exists:', composer);
  const disabled = await evaluate('document.querySelector("[data-testid=\'codex-composer\'] textarea")?.disabled');
  console.log('Textarea disabled:', disabled);
  const textValue = await evaluate('document.querySelector("[data-testid=\'codex-composer\'] textarea")?.value');
  console.log('Textarea value:', textValue);
  const activeGoal = await evaluate('window.localStorage.getItem("agenticos:codex-active-goal-id")');
  console.log('Active goal in localStorage:', activeGoal);
  const buttons = await evaluate('Array.from(document.querySelectorAll("[data-testid=\'codex-composer\'] button")).map(b => b.innerText)');
  console.log('Composer buttons:', buttons);

  ws.close();
})();
