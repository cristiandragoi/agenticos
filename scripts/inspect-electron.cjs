const http = require('http');

async function main() {
  const pagesRes = await fetch('http://localhost:9222/json');
  const pages = await pagesRes.json();
  const page = pages.find(p => p.type === 'page');
  if (!page) {
    console.error('No page found');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          return JSON.stringify({
            href: window.location.href,
            buildId: window.__JARVIS_BUILD_ID || null,
            route: window.location.hash || window.location.pathname,
            title: document.title,
            bodyPreview: document.body.innerText.slice(0, 200).replace(/\\s+/g, ' ')
          });
        })()`
      }
    }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id === 1) {
      console.log('UI_STATE:', data.result.result.value);
      ws.close();
      process.exit(0);
    }
  };

  ws.onerror = (e) => {
    console.error('WS error:', e);
    process.exit(1);
  };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
