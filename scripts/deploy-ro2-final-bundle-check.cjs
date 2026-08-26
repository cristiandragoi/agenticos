/* RO2 final: confirm packaged bundle = final build (titlebar fix) + endpoints live on restarted backend */
const fs = require('fs');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const html = fs.readFileSync(`${RES}/app/dist/index.html`, 'utf-8');
const jsAsset = (html.match(/assets\/(index-[^"]+\.js)/) || [])[1];
const bundle = fs.readFileSync(`${RES}/app/dist/assets/${jsAsset}`, 'utf-8');
console.log('asset:', jsAsset);
console.log('titlebar fix present (top-[48px] overlays):', bundle.includes('top-[48px]'));
console.log('drawer-close testid present:', bundle.includes('drawer-close'));
console.log('kpi-modal-close present:', bundle.includes('kpi-modal-close'));
(async () => {
  for (const p of ['/api/health', '/api/revenue-operator/missions']) {
    const r = await fetch('http://localhost:4000' + p);
    console.log(r.status, p);
  }
  const m = await (await fetch('http://localhost:4000/api/revenue-operator/missions')).json();
  const mid = m.missions[0].id;
  const t = await fetch(`http://localhost:4000/api/revenue-operator/missions/${mid}/trace`);
  const b = await fetch(`http://localhost:4000/api/revenue-operator/missions/${mid}/board/digital_products`);
  console.log(t.status, 'trace |', b.status, 'board');
})();
