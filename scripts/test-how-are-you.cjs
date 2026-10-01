const WebSocket = require('ws');
const http = require('http');

async function getPageTarget() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find((t) => t.type === 'page');
          if (page) resolve(page);
          else reject(new Error('No page target found'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (msg) => {
      try {
        const res = JSON.parse(msg);
        if (res.id === id) {
          ws.off('message', handler);
          if (res.error) reject(new Error(JSON.stringify(res.error)));
          else resolve(res.result);
        }
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInPage(ws, expr, awaitPromise = true) {
  const res = await sendCDP(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error('Eval exception: ' + JSON.stringify(res.exceptionDetails));
  }
  return res.result?.value;
}

async function main() {
  const page = await getPageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.once('open', resolve));

  await sendCDP(ws, 'Runtime.enable');

  const logs = [];
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = data.params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
        logs.push(text);
        if (text.includes('VTimeline') || text.includes('VoiceDiag') || text.includes('playback')) {
          console.log('[CONSOLE]', text);
        }
      }
    } catch {}
  });

  console.log('--- TEST 4: Sending "How are you?" to Jarvis ---');
  const res = await evalInPage(ws, `(async () => {
    const turnId = ++window.__JARVIS_DEV__.turnSeqRef.current;
    window.__JARVIS_DEV__.voiceRef?.current?.armSpeech?.(turnId);
    window.__JARVIS_DEV__.chatRef.current.sendMessage('How are you?', 'voice', turnId);
    return { turnId };
  })()`);
  console.log('Turn started:', res);

  await new Promise(r => setTimeout(r, 7000));
  console.log('Test 4 complete.');
  ws.close();
}

main().catch(console.error);
