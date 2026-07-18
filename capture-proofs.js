import puppeteer from 'puppeteer';

async function run() {
  console.log('Launching puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const artifactDir = 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1';

  console.log('Navigating to / ...');
  await page.goto('http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Clicking Loops...');
  await page.click('a[href="/loops"]');
  await new Promise(r => setTimeout(r, 2000));
  console.log('Title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\proof_loops_board.png` });

  console.log('Clicking Video...');
  await page.click('a[href="/video"]');
  await new Promise(r => setTimeout(r, 2000));
  console.log('Title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\proof_video_board.png` });

  console.log('Clicking Providers...');
  await page.click('a[href="/providers"]');
  await new Promise(r => setTimeout(r, 2000));
  console.log('Title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\proof_providers_board.png` });

  // Now, click "Refresh Auth" on prov-internal-api if we can
  console.log('Clicking Refresh Auth...');
  try {
    const refreshBtns = await page.$$('.quick-action-btn');
    if (refreshBtns.length > 0) {
      await refreshBtns[0].click();
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: `${artifactDir}\\proof_providers_after_refresh.png` });
    }
  } catch (e) {
    console.log('Could not click refresh auth:', e.message);
  }

  await browser.close();
  console.log('Done.');
}

run().catch(console.error);
