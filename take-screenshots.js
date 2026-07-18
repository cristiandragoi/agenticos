import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function takeScreenshots() {
  const artifactDir = 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1';
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Home Page / Providers
  console.log('Navigating to Home...');
  await page.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Clicking Providers link...');
  await page.click('a[href="/providers"]');
  await new Promise(r => setTimeout(r, 3000));
  console.log('Page title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\phase10_providers_board.png` });
  
  // Click Refresh Auth
  console.log('Clicking Refresh Auth...');
  const refreshBtns = await page.$$('.quick-action-btn');
  if (refreshBtns.length > 0) {
    await refreshBtns[0].click();
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: `${artifactDir}\\phase10_providers_after_refresh.png` });
  }

  // 2. Click Loops
  console.log('Clicking Loops link...');
  await page.click('a[href="/loops"]');
  await new Promise(r => setTimeout(r, 3000));
  console.log('Page title:', await page.title());
  
  // Click Configure
  const configureBtns = await page.$$('button');
  for (const btn of configureBtns) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text === 'Configure Loop') {
      await btn.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${artifactDir}\\phase10_loops_config.png` });

  // 3. Click Video
  console.log('Clicking Video link...');
  await page.goto('http://127.0.0.1:4180/video', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000)); 
  console.log('Page title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\phase10_video_previews.png` });

  await browser.close();
  console.log('Screenshots captured successfully.');
}

takeScreenshots().catch(console.error);
