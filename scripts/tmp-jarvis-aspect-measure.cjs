// Live measurement of the Jarvis orb canvas geometry in the running Electron renderer.
const WebSocket = require('D:/AgenticOS/node_modules/ws');
const fs = require('fs');

(async () => {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page' && String(t.url).includes('5173'));
  if (!page) { console.log('NO PAGE TARGET', targets.map(t => t.type + ' ' + t.url)); return; }
  console.log('TARGET', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.off('message', handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result?.value;
  };

  // ensure we are on the jarvis route
  const hashBefore = await evaluate('window.location.hash');
  console.log('hash before:', hashBefore);
  if (String(hashBefore) !== '#/jarvis') {
    await evaluate("window.location.hash = '#/jarvis'");
    await new Promise(r => setTimeout(r, 9000));
  }
  // give the orb time to mount + size
  await new Promise(r => setTimeout(r, 6000));

  const measurement = await evaluate(`(() => {
    const out = {};
    out.hash = location.hash;
    out.viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
    const region = document.querySelector('[data-testid="jarvis-orb-region"]');
    const canvas = document.querySelector('canvas[aria-label^="Jarvis neural core"]') || document.querySelector('canvas');
    if (!canvas) { out.error = 'no canvas'; return out; }
    const r = canvas.getBoundingClientRect();
    const cs = getComputedStyle(canvas);
    out.canvas = {
      bufferW: canvas.width, bufferH: canvas.height,
      bufferAspect: +(canvas.width / canvas.height).toFixed(4),
      cssW: cs.width, cssH: cs.height,
      rectW: +r.width.toFixed(2), rectH: +r.height.toFixed(2),
      boxAspect: +(r.width / r.height).toFixed(4),
      rectTop: +r.top.toFixed(1), rectLeft: +r.left.toFixed(1)
    };
    out.stretchFactor = +((r.width / r.height) / (canvas.width / canvas.height)).toFixed(4);
    out.ariaLabel = canvas.getAttribute('aria-label');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    out.gl = gl ? { drawingBufferW: gl.drawingBufferWidth, drawingBufferH: gl.drawingBufferHeight, dpr: gl.drawingBufferWidth / Math.max(1, r.width) } : null;
    const shell = canvas.parentElement;
    const sr = shell.getBoundingClientRect();
    out.shell = { cls: shell.className, w: +sr.width.toFixed(1), h: +sr.height.toFixed(1), inlineHeight: shell.style.height, transform: getComputedStyle(shell).transform };
    if (region) { const rr = region.getBoundingClientRect(); out.region = { w: +rr.width.toFixed(1), h: +rr.height.toFixed(1), cls: region.className }; }
    const chain = []; let a = shell.parentElement;
    while (a && chain.length < 8) {
      const ar = a.getBoundingClientRect(); const acs = getComputedStyle(a);
      chain.push({ tag: a.tagName + (a.className ? '.' + String(a.className).slice(0, 30) : ''), w: Math.round(ar.width), h: Math.round(ar.height), overflow: acs.overflow, transform: acs.transform === 'none' ? 'none' : acs.transform, aspect: acs.aspectRatio });
      a = a.parentElement;
    }
    out.ancestors = chain;
    return out;
  })()`);

  console.log('MEASUREMENT');
  console.log(JSON.stringify(measurement, null, 1));

  // screenshot the whole window and also just the canvas rect
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outPath = process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Temp/jarvis-core-full.png';
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('SCREENSHOT_FULL', outPath);

  if (measurement && measurement.canvas) {
    const c = measurement.canvas;
    const clip = { x: Math.max(0, c.rectLeft), y: Math.max(0, c.rectTop), width: c.rectW, height: c.rectH, scale: 1 };
    const shot2 = await send('Page.captureScreenshot', { format: 'png', clip });
    const outPath2 = process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Temp/jarvis-core-clip.png';
    fs.writeFileSync(outPath2, Buffer.from(shot2.data, 'base64'));
    console.log('SCREENSHOT_CLIP', outPath2, JSON.stringify(clip));
  }
  ws.close();
})();
