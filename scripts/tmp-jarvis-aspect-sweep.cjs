// Aspect-tracking test: vary the renderer viewport and record canvas buffer vs CSS box.
const WebSocket = require('D:/AgenticOS/node_modules/ws');
const fs = require('fs');

(async () => {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page' && String(t.url).includes('5173'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) { ws.off('message', handler); if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result?.value;
  };
  const probe = `(() => {
    const canvas = document.querySelector('canvas[aria-label^="Jarvis neural core"]');
    if (!canvas) return { error: 'no canvas' };
    const r = canvas.getBoundingClientRect();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return {
      viewport: innerWidth + 'x' + innerHeight,
      buffer: canvas.width + 'x' + canvas.height,
      box: Math.round(r.width) + 'x' + Math.round(r.height),
      bufferAspect: +(canvas.width / canvas.height).toFixed(4),
      boxAspect: +(r.width / r.height).toFixed(4),
      stretch: +((r.width / r.height) / (canvas.width / canvas.height)).toFixed(4),
      drawingBuffer: gl ? gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight : null,
      shellHeight: canvas.parentElement.style.height
    };
  })()`;

  const sizes = [[1360, 840], [1900, 700], [1000, 1000], [2400, 900]];
  const results = [];
  for (const [w, h] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 2500));
    const m = await evaluate(probe);
    results.push(m);
    console.log('SIZE', w + 'x' + h, JSON.stringify(m));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const p = process.env.LOCALAPPDATA.replace(/\\/g, '/') + `/Temp/jarvis-core-${w}x${h}.png`;
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log('  shot:', p);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('CLEARED');
  ws.close();
})();
