// final-accept-ui.cjs — live packaged Jarvis UI/WebGL acceptance via CDP
const http = require('http');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await getJSON('http://127.0.0.1:9223/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.log('NO_PAGE'); process.exit(2); }
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } });
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };

  // 1. Real DOM click on nav-jarvis (no location.hash, no router call)
  await evalJs(`(function(){ const el = document.querySelector('[data-testid="nav-jarvis"]') || document.querySelector('a[href="#/jarvis"]'); if(el){ el.click(); return 'clicked:' + (el.getAttribute('data-testid')||el.getAttribute('href')); } return 'NOT_FOUND'; })()`);
  await sleep(2500);
  const route = await evalJs('location.hash');

  // 2. Inspect the loaded Jarvis surface
  const state = await evalJs(`(function(){
    const q = (s) => document.querySelector(s);
    const qa = (s) => document.querySelectorAll(s).length;
    const canvas = q('canvas[data-testid="jarvis-neural-canvas"]') || q('canvas');
    let gl2 = null, gl1 = null, size = null, pixels = null;
    if (canvas) {
      try { gl2 = canvas.getContext('webgl2'); } catch(e){}
      try { gl1 = canvas.getContext('webgl'); } catch(e){}
      size = canvas.width + 'x' + canvas.height;
      if (gl2) {
        try {
          const px = new Uint8Array(64*64*4);
          gl2.readPixels(0,0,64,64, gl2.RGBA, gl2.UNSIGNED_BYTE, px);
          let nonZero=0; const colors=new Set();
          for (let i=0;i<px.length;i+=4){ if(px[i]||px[i+1]||px[i+2]) nonZero++; colors.add(px[i]+','+px[i+1]+','+px[i+2]); }
          pixels = { nonZero, distinctColors: colors.size };
        } catch(e){ pixels = 'readPixels-error:' + e.message; }
      }
    }
    return {
      route: location.hash,
      webgl2: !!gl2, webgl1: !!gl1, canvasSize: size, pixels,
      orbCanvas: qa('[data-testid="jarvis-neural-canvas"]'),
      modelLabel: (q('[data-testid="jarvis-neural-model"]')||{}).textContent || null,
      blobOrbEls: qa('[data-testid*="orb"], [data-testid*="blob"]'),
      nodeEls: qa('[data-testid*="node"], [data-testid*="capability"]'),
      taskInput: !!q('textarea, input[type="text"], [contenteditable="true"]'),
      inputPlaceholder: (q('textarea')||{}).placeholder || (q('input')||{}).placeholder || null,
      backendStatus: (document.body.innerText.match(/Connected[^\\n]*:4000/)||[''])[0] || null,
      appShell: qa('.app-shell'),
      bodyHasError: document.body.innerText.toLowerCase().includes('cannot read properties of null'),
    };
  })()`);

  console.log(JSON.stringify(state, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
