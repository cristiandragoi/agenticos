const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    defaultViewport: { width: 1280, height: 1200 }
  });
  
  const page = await browser.newPage();
  
  try {
    // 1. Boards
    await page.goto('http://localhost:5173/boards', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_boards.png' });
    
    // 2. Providers -> Open Apify Drawer
    await page.goto('http://localhost:5173/providers', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    const clickedApify = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.entity-card'));
      const apify = cards.find(c => c.textContent.includes('Apify Platform'));
      if (apify) { apify.click(); return true; }
      return false;
    });
    
    if (clickedApify) {
      await new Promise(r => setTimeout(r, 1000));
      
      // Expand drawer to see everything
      await page.evaluate(() => {
        const body = document.querySelector('.drawer-body');
        if (body) body.style.overflow = 'visible';
        const panel = document.querySelector('.inspector-drawer');
        if (panel) panel.style.height = 'auto';
      });
      await new Promise(r => setTimeout(r, 500));
      
      const drawerEl = await page.$('.inspector-drawer');
      if (drawerEl) {
        await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_drawer.png' });
      }

      const clickedTest = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.magic-bento-card'));
        const test = cards.find(c => c.textContent.includes('Test Connection'));
        if (test) { test.click(); return true; }
        return false;
      });
      
      if (clickedTest) {
        await new Promise(r => setTimeout(r, 500));
        if (drawerEl) await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_test_testing.png' });
        await new Promise(r => setTimeout(r, 1500));
        if (drawerEl) await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_test_tested.png' });
      }

      const clickedRun = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.magic-bento-card'));
        const runBtn = cards.find(c => c.textContent.includes('Run Sample Actor'));
        if (runBtn) { runBtn.click(); return true; }
        return false;
      });
      
      if (clickedRun) {
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_chat_routing.png' });
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
  }
}
run();
