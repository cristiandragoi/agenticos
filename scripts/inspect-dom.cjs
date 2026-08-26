const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve(__dirname, '../server/node_modules/ws'));

async function inspect() {
  const child = spawn('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/Agentic OS.exe', [], {
    env: { ...process.env, AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT: '9228' }
  });
  await new Promise(r => setTimeout(r, 4000));
  http.get('http://127.0.0.1:9228/json/list', res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      const targets = JSON.parse(d);
      const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
      ws.on('open', () => {
        // First click retry if present
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              const retryBtn = document.querySelector('[data-testid="app-backend-retry"]');
              if (retryBtn) retryBtn.click();
              return 'clicked_retry_or_ready';
            })()`,
            returnByValue: true
          }
        }));
      });

      ws.on('message', m => {
        const res = JSON.parse(m.toString());
        if (res.id === 1) {
          // Click retry
          ws.send(JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const btn = document.querySelector('[data-testid="app-backend-retry"]');
                if (btn) btn.click();
                return btn !== null;
              })()`,
              returnByValue: true
            }
          }));
        } else if (res.id === 2) {
          setTimeout(() => {
            ws.send(JSON.stringify({
              id: 3,
              method: 'Runtime.evaluate',
              params: {
                expression: `document.body.innerHTML`,
                returnByValue: true
              }
            }));
          }, 2000);
        } else if (res.id === 3) {
          console.log('DOM INSPECT ID 3 RESULT:', JSON.stringify(res.result.result.value, null, 2));
          ws.send(JSON.stringify({
            id: 4,
            method: 'Runtime.evaluate',
            params: {
              expression: `({
                error: document.querySelector('[data-testid="error-boundary-fallback"]')?.innerText,
                navCodex: document.querySelector('[data-testid="nav-codex"]') !== null,
                navRail: document.querySelector('[data-testid="nav-rail"]') !== null
              })`,
              returnByValue: true
            }
          }));
        } else if (res.id === 4) {
          console.log('DOM FINAL AUDIT:', JSON.stringify(res.result.result.value, null, 2));
          ws.send(JSON.stringify({ id: 5, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }));
          setTimeout(() => process.exit(0), 1000);
        }
      });
    });
  });
}

inspect();
