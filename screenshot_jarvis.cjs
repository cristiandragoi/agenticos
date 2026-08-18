const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/boards');
  
  // Wait for loading to finish
  await page.waitForSelector('.left-rail');
  
  // Click Jarvis Voice button
  const elements = await page.$$('button');
  for (const el of elements) {
    const text = await page.evaluate(e => e.textContent, el);
    if (text && text.includes('Jarvis Voice')) {
      await el.click();
      break;
    }
  }

  // Wait for drawer to open
  await page.waitForSelector('.inspector-drawer.open');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '../../brain/f5fca1d9-e35e-4e53-bc80-f870e0bf93b1/jarvis_drawer_idle.png' });
  console.log('Took jarvis_drawer_idle.png');

  // Click Mic
  const micButton = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('.inspector-drawer.open button')).find(b => b.style.width === '80px');
  });
  
  await micButton.click();
  console.log('Clicked Mic');
  
  // Wait for 'transcribing'
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '../../brain/f5fca1d9-e35e-4e53-bc80-f870e0bf93b1/jarvis_drawer_transcribing.png' });
  console.log('Took jarvis_drawer_transcribing.png');

  // Wait for 'thinking'
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '../../brain/f5fca1d9-e35e-4e53-bc80-f870e0bf93b1/jarvis_drawer_thinking.png' });
  console.log('Took jarvis_drawer_thinking.png');

  // Wait for 'speaking'
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '../../brain/f5fca1d9-e35e-4e53-bc80-f870e0bf93b1/jarvis_drawer_speaking.png' });
  console.log('Took jarvis_drawer_speaking.png');

  await browser.close();
})();
