// Phase 20E / Phase 26: verify the VAD animation loop survives window
// minimization (backgroundThrottling:false). Minimize → measure rAF →
// restore. Uses raw CDP over the browser websocket (puppeteer-core's
// createCDPSession is unavailable on a connected browser).
import WebSocket from 'ws';

const CDP = 'http://127.0.0.1:9223';
const version = await (await fetch(`${CDP}/json/version`)).json();
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('NO_PAGE'); process.exit(1); }
console.log('PAGE_URL:', page.url.slice(0, 90));

function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== id) return;
      ws.off('message', onMsg);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Browser session for window controls
const browserWs = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => browserWs.on('open', r));
const { windowId } = await cdp(browserWs, 1, 'Browser.getWindowForTarget', { targetId: page.id });

// Page session for runtime evaluation
const pageWs = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => pageWs.on('open', r));

async function measure(label) {
  await cdp(pageWs, 10, 'Runtime.evaluate', { expression: `window.__rafProbe = 0; const f = () => { window.__rafProbe += 1; requestAnimationFrame(f); }; requestAnimationFrame(f);`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 2000));
  const res = await cdp(pageWs, 11, 'Runtime.evaluate', {
    expression: `({ hidden: document.hidden, vis: document.visibilityState, raf: window.__rafProbe })`,
    returnByValue: true,
  });
  console.log(`${label}:`, JSON.stringify(res.result.value));
}

await measure('NORMAL');
await cdp(browserWs, 2, 'Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
await new Promise((r) => setTimeout(r, 1500));
await measure('MINIMIZED');
await cdp(browserWs, 3, 'Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
await new Promise((r) => setTimeout(r, 1500));
await measure('RESTORED');

browserWs.close();
pageWs.close();
