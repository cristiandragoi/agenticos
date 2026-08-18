import puppeteer from 'puppeteer';
import fs from 'fs/promises';

async function extractSelector() {
  const artifactDir = 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1';
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  console.log('Navigating to Home...');
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  
  try {
    await page.waitForSelector('.chat-dock__context-bar select', { timeout: 10000 });
    const html = await page.evaluate(() => {
      const select = document.querySelector('.chat-dock__context-bar select');
      return select ? select.outerHTML : 'null';
    });
    await fs.writeFile(`${artifactDir}\\chat_selector.html`, html);
    console.log('Extracted chat selector successfully.');
  } catch (e) {
    console.error('Failed to extract chat selector HTML:', e);
  }

  await browser.close();
}

extractSelector().catch(console.error);
