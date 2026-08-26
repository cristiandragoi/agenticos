/* RO2 deploy: re-check dynamic testid markers in packaged bundle */
const fs = require('fs');
const html = fs.readFileSync('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/index.html', 'utf-8');
const jsAsset = (html.match(/assets\/(index-[^"]+\.js)/) || [])[1];
const bundle = fs.readFileSync(`C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/assets/${jsAsset}`, 'utf-8');
for (const m of ['kanban-', 'tab-', 'card-', 'kpi-realized', 'kpi-verified', 'kpi-pipeline', 'kpi-cost', 'kpi-net', 'kpi-adspend', 'kpi-days']) {
  console.log(bundle.includes(m) ? 'MARKER ' : 'MISSING ', m);
}
// the 10 digital columns + 10 SME column keys as literal strings in bundle
for (const c of ['DISCOVER', 'GO_NO_GO', 'SCALE_ITERATE_KILL', 'OUTBOUND_APPROVAL', 'CONTACT_READY']) {
  console.log(bundle.includes(c) ? 'COLKEY ' : 'MISSING ', c);
}
