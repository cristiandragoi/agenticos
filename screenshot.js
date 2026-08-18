import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function takeScreenshots() {
  const artifactDir = 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1';
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Home Page / Chat Dock
  console.log('Navigating to Home...');
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Page title:', await page.title());
  
  try {
    const html = await page.evaluate(() => {
      const select = document.querySelector('.chat-dock__context-bar select');
      return select ? select.outerHTML : null;
    });
    await fs.writeFile(`${artifactDir}\\chat_selector.html`, html ?? 'Select not found');
    console.log('Saved chat_selector.html');
  } catch (e) {
    console.error('Failed to extract HTML:', e);
  }
  await page.screenshot({ path: `${artifactDir}\\live_chat_dock.png` });
  console.log('Saved live_chat_dock.png');

  // 2. Click Loops
  console.log('Clicking Loops link...');
  await page.click('a[href="/loops"]');
  await new Promise(r => setTimeout(r, 3000)); // wait for transition and fetch
  console.log('Page title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\live_loops_board.png` });
  console.log('Saved live_loops_board.png');

  // 3. Click Video
  console.log('Clicking Video link...');
  await page.click('a[href="/video"]');
  await new Promise(r => setTimeout(r, 3000)); // wait for transition and fetch
  console.log('Page title:', await page.title());
  await page.screenshot({ path: `${artifactDir}\\live_video_board.png` });
  console.log('Saved live_video_board.png');

  await browser.close();
  console.log('Screenshots captured successfully.');
}

takeScreenshots().catch(console.error);
