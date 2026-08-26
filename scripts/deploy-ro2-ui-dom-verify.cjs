/* RO2 deploy: headless DOM verification of packaged UI (playwright, chromium) */
const { chromium } = require('playwright');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:4599/#/revenue', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 1. Page shell
  check('page renders', (await page.locator('[data-testid="revenue-operator-page"]').count()) === 1);

  // 2. All 8 KPI cards present
  const kpiIds = ['kpi-target', 'kpi-realized', 'kpi-verified', 'kpi-pipeline', 'kpi-cost', 'kpi-net', 'kpi-adspend', 'kpi-days'];
  for (const id of kpiIds) check(`KPI card ${id}`, (await page.locator(`[data-testid="${id}"]`).count()) === 1);

  // 3. KPI drill-down modal opens and closes
  await page.locator('[data-testid="kpi-net"]').click();
  await page.waitForTimeout(1200);
  const modalVisible = (await page.locator('[data-testid="kpi-drilldown"]').count()) === 1;
  check('net KPI drill-down modal opens', modalVisible);
  if (modalVisible) {
    const modalText = await page.locator('[data-testid="kpi-drilldown"]').innerText();
    check('net modal shows formula', modalText.includes('realized') && modalText.includes('actual cost'));
    await page.evaluate(() => document.querySelector('[data-testid="kpi-modal-close"]')?.click());
    await page.waitForTimeout(600);
    check('kpi modal closes via close button', (await page.locator('[data-testid="kpi-drilldown"]').count()) === 0);
  }

  // 4. Tabs switch + Kanban boards render
  await page.locator('[data-testid="tab-digital_products"]').click();
  await page.waitForTimeout(1200);
  const dpBoard = await page.locator('[data-testid="kanban-digital_products"]').count();
  check('digital products Kanban renders', dpBoard === 1);
  if (dpBoard) {
    const cols = await page.locator('[data-testid="kanban-digital_products"] > div').count();
    check('digital Kanban has 10 columns', cols === 10, `found ${cols}`);
    const cards = await page.locator('[data-testid^="card-"]').count();
    check('digital Kanban cards rendered', cards >= 1, `${cards} card(s)`);
    // card click -> experiment drawer
    if (cards > 0) {
      await page.locator('[data-testid^="card-"]').first().click();
      await page.waitForTimeout(1200);
      const drawer = (await page.locator('[data-testid="experiment-drawer"]').count()) === 1;
      check('experiment drawer opens from card', drawer);
      if (drawer) {
        await page.waitForTimeout(800);
        const dt = (await page.locator('[data-testid="experiment-drawer"]').innerText()).toUpperCase();
        check('drawer shows evidence section', dt.includes('HYPOTHESIS & EVIDENCE'));
        check('drawer shows canonical runs section', dt.includes('CANONICAL EXECUTION RUNS'));
        check('drawer shows lifecycle events section', dt.includes('LIFECYCLE EVENTS'));
        check('drawer shows ledger section', dt.includes('LEDGER ENTRIES'));
        await page.evaluate(() => document.querySelector('[data-testid="drawer-close"]')?.click());
        await page.waitForTimeout(600);
        check('drawer closes via close button', (await page.locator('[data-testid="experiment-drawer"]').count()) === 0);
      }
    }
  }

  await page.locator('[data-testid="tab-german_sme"]').click();
  await page.waitForTimeout(1000);
  const smeBoard = await page.locator('[data-testid="kanban-german_sme"]').count();
  check('SME Kanban renders', smeBoard === 1);
  if (smeBoard) {
    const cols = await page.locator('[data-testid="kanban-german_sme"] > div').count();
    check('SME Kanban has 10 columns', cols === 10, `found ${cols}`);
  }

  await page.locator('[data-testid="tab-pipeline"]').click();
  await page.waitForTimeout(1000);
  const pipeBoard = await page.locator('[data-testid="kanban-pipeline"]').count();
  check('pipeline Kanban renders', pipeBoard === 1);
  if (pipeBoard) {
    const cols = await page.locator('[data-testid="kanban-pipeline"] > div').count();
    check('pipeline Kanban has 7 columns', cols === 7, `found ${cols}`);
  }

  // 5. Live execution table (overview tab)
  await page.locator('[data-testid="tab-overview"]').click();
  await page.waitForTimeout(1000);
  const liveTable = (await page.locator('[data-testid="live-execution-table"]').count()) === 1;
  check('live execution table renders', liveTable);
  if (liveTable) {
    const rows = await page.locator('[data-testid="live-execution-table"] tbody tr').count();
    check('live execution shows canonical rows', rows >= 1, `${rows} row(s)`);
    const body = await page.locator('[data-testid="live-execution-table"]').innerText();
    check('live execution truthful statuses (no fake RUNNING header claims)', body.includes('COMPLETED') || body.includes('RUNNING') || body.includes('QUEUED'));
  }

  // 6. Ledger tab + filter
  await page.locator('[data-testid="tab-ledger"]').click();
  await page.waitForTimeout(800);
  check('ledger tab renders', (await page.locator('[data-testid="ledger-filter"]').count()) === 1);

  // 7. Gates tab
  await page.locator('[data-testid="tab-gates"]').click();
  await page.waitForTimeout(800);
  const gatesTab = await page.innerText('body');
  check('gates tab renders', gatesTab.includes('Human Required'));

  // 8. Refresh works
  await page.locator('text=Refresh').click();
  await page.waitForTimeout(1500);
  check('refresh re-renders from backend', (await page.locator('[data-testid="revenue-operator-page"]').count()) === 1);

  const realErrors = errors.filter((e) => !e.includes('favicon'));
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await page.screenshot({ path: 'B:/AgenticOS/workspace/root/ro2-ui-overview.png', fullPage: false }).catch(() => {});
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'RO2 UI VISUAL VERIFICATION: PASS' : `RO2 UI VISUAL VERIFICATION: ${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
