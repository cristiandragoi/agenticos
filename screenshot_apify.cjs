const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    defaultViewport: { width: 1280, height: 800 }
  });
  
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  try {
    // 1. Boards
    console.log("Navigating to /boards...");
    await page.goto('http://localhost:5173/boards', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\apify_boards.png' });
    console.log("Took apify_boards.png");

    // 2. Providers -> Open Apify Drawer
    console.log("Navigating to /providers...");
    await page.goto('http://localhost:5173/providers', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    // Find Apify provider and click it
    const clickedApify = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.entity-card'));
      const apify = cards.find(c => c.textContent.includes('Apify Platform'));
      if (apify) {
        apify.click();
        return true;
      }
      return false;
    });
    
    if (clickedApify) {
      console.log("Clicked Apify Platform card");
      await new Promise(r => setTimeout(r, 1000));
      
      // 3. Screenshot the drawer (Idle state)
      await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\apify_drawer_idle.png' });
      console.log("Took apify_drawer_idle.png");
      
      // Scroll to bottom
      await page.evaluate(() => {
        const drawer = document.querySelector('.drawer-body');
        if (drawer) drawer.scrollTop = drawer.scrollHeight;
      });
      await new Promise(r => setTimeout(r, 500));
      
      // 4. Test Connection
      const clickedTest = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.magic-bento-card'));
        const test = cards.find(c => c.textContent.includes('Test Connection'));
        if (test) {
          test.click();
          return true;
        }
        return false;
      });
      
      if (clickedTest) {
        console.log("Clicked Test Connection");
        await new Promise(r => setTimeout(r, 500));
        await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\apify_drawer_testing.png' });
        console.log("Took apify_drawer_testing.png");
        
        // Wait for it to turn green
        await new Promise(r => setTimeout(r, 1500));
        await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\apify_drawer_tested.png' });
        console.log("Took apify_drawer_tested.png");
      }

      // 5. Run Sample Actor -> Routes to Universal Chat
      const clickedRun = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.magic-bento-card'));
        const runBtn = cards.find(c => c.textContent.includes('Run Sample Actor'));
        if (runBtn) {
          runBtn.click();
          return true;
        }
        return false;
      });
      
      if (clickedRun) {
        console.log("Clicked Run Sample Actor");
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\apify_chat_routing.png' });
        console.log("Took apify_chat_routing.png");
      }
    } else {
      console.error("Could not find Apify Platform card");
    }
  } catch (error) {
    console.error("Error during screenshot script:", error);
  } finally {
    await browser.close();
  }
}

run();
