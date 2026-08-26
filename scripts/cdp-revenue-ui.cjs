const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve('B:/AgenticOS/server/node_modules/ws'));
const DEBUG_PORT = '9223';

function fetchTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const targets = await fetchTargets();
  const page = targets.filter(t => t.type === 'page')[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 1; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((resolve) => { const mid = id++; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalv = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  // Navigate to revenue
  await evalv(`window.location.hash = '#/revenue'; 0`);
  await sleep(4000);

  const out = await evalv(`(function(){
    var bar = document.querySelector('[data-testid="supervisor-control-bar"]');
    var barText = bar ? bar.textContent : 'NO BAR';
    var btns = Array.from(document.querySelectorAll('button')).map(function(b){return b.textContent;});
    var hasStart = btns.some(function(t){return t.indexOf('START')>=0 || t.indexOf('RESUME')>=0;});
    var hasStop = btns.some(function(t){return t.indexOf('STOP')>=0;});
    var hasPause = btns.some(function(t){return t.indexOf('PAUSE')>=0;});
    var hasBriefing = btns.some(function(t){return t.indexOf('Briefing')>=0;});
    var bodyText = document.body.textContent;
    var gateBanner = bodyText.match(/\\d+ human gate/);
    return {
      barText: barText.replace(/\\s+/g,' ').trim(),
      hasStartResume: hasStart, hasStop: hasStop, hasPause: hasPause, hasBriefing: hasBriefing,
      gateBanner: gateBanner ? gateBanner[0] : null,
      kpiCards: document.querySelectorAll('[data-testid^="kpi-"]').length,
      revenuePage: !!document.querySelector('[data-testid="revenue-operator-page"]')
    };
  })()`);

  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('err', e.message); process.exit(1); });
