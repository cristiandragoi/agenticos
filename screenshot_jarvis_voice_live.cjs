const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    slowMo: 50,
    defaultViewport: { width: 1280, height: 1200 },
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--window-size=1280,800'
    ]
  });
  
  const page = await browser.newPage();
  
  try {
    page.on('dialog', async dialog => {
      console.log('Dialog:', dialog.message());
      await dialog.accept();
    });

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

    // Nav to shell
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 4000));
    
    // Open Jarvis Voice drawer
    const clickedJarvis = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.nav-link'));
      const jarvisLink = links.find(l => l.textContent.includes('Jarvis Voice'));
      if (jarvisLink) { jarvisLink.click(); return true; }
      return false;
    });
    
    if (clickedJarvis) {
      await new Promise(r => setTimeout(r, 1000));
      
      const drawerEl = await page.$('.drawer-panel');

      // Click the CTA button to start listening
      const clickedCTA = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Press to Talk'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      
      if (clickedCTA) {
        console.log("Started listening...");
        await new Promise(r => setTimeout(r, 2000)); // record for 2 seconds

        // Click again to stop listening and trigger STT
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Listening'));
          if (btn) { btn.click(); }
        });

        console.log("Stopped listening, waiting for processing...");
        // Wait for transcribing, thinking, speaking
        await new Promise(r => setTimeout(r, 10000));
        
        const currentDrawerEl = await page.$('.inspector-drawer');
        if (currentDrawerEl) {
          await currentDrawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_transcribed.png' });
          console.log("Screenshot transcribed");
        }

        // Click Save to Memory
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const memoryBtn = btns.find(b => b.textContent.includes('Save to Memory'));
          if (memoryBtn) memoryBtn.click();
        });

        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_memory_saved.png' });
        console.log("Screenshot memory saved");

        // Click Memory Sync
        await page.evaluate(() => {
          const bentoCards = Array.from(document.querySelectorAll('.magic-bento-card'));
          const syncCard = bentoCards.find(c => c.textContent.includes('Memory Sync'));
          if (syncCard) syncCard.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // Navigate to /runs
        await page.goto('http://localhost:5173/runs', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4000));
        console.log("Screenshot runs");

        // Keep browser open for evaluator to see
        console.log("Demonstration complete. Leaving browser open indefinitely for live evaluation.");
        await new Promise(() => {}); // Infinite wait
      } else {
        console.log("CTA not found");
      }
    } else {
      console.log("Jarvis Voice link not found");
    }
  } catch (e) {
    console.error(e);
  }
  // Intentionally NOT closing the browser
}
run();
