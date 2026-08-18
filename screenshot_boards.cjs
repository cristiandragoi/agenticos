const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:5173/boards');
  
  // Wait for loading to finish
  await page.waitForSelector('.magic-bento-card');
  
  // Hover over the first card
  const card = await page.$('.magic-bento-card');
  if (card) {
    await card.hover();
    await new Promise(r => setTimeout(r, 1000));
  }

  await page.screenshot({ path: '../../brain/f5fca1d9-e35e-4e53-bc80-f870e0bf93b1/boards_bento_hover.png' });
  console.log('Took boards_bento_hover.png');

  await browser.close();
})();
