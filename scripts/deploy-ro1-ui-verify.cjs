/* RO1 deploy: UI verification — route registration + packaged bundle markers + LeftRail nav */
const fs = require('fs');
const app = fs.readFileSync('B:/AgenticOS/src/App.tsx', 'utf-8');
for (const line of app.split('\n')) {
  if (/revenue/i.test(line)) console.log('App.tsx:', line.trim());
}
const lr = fs.readFileSync('B:/AgenticOS/src/components/layout/LeftRail.tsx', 'utf-8');
for (const line of lr.split('\n')) {
  if (/revenue/i.test(line)) console.log('LeftRail:', line.trim());
}
const bundle = fs.readFileSync('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist/assets/index-D5IVkBcZ.js', 'utf-8');
console.log('\nbundle has revenue-operator route:', bundle.includes('revenue-operator'));
console.log('bundle has REVENUE OPERATOR title:', bundle.includes('REVENUE OPERATOR'));
console.log('bundle has 30-DAY TARGET:', bundle.includes('30-DAY TARGET'));
console.log('bundle has REALIZED REVENUE:', bundle.includes('REALIZED REVENUE'));
console.log('bundle has VERIFIED REVENUE:', bundle.includes('VERIFIED REVENUE'));
console.log('bundle has PIPELINE VALUE:', bundle.includes('PIPELINE VALUE'));
console.log('bundle has HUMAN REQUIRED:', bundle.includes('HUMAN REQUIRED'));
console.log('bundle has DIGITAL PRODUCTS:', bundle.includes('DIGITAL PRODUCTS'));
console.log('bundle has GERMAN SME:', bundle.includes('GERMAN SME'));
console.log('bundle apiFetch revenue-operator client:', bundle.includes('/api/revenue-operator/observability/'));
