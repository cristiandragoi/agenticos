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
    // Nav to shell
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    // Open Jarvis Voice drawer
    const clickedJarvis = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.nav-item'));
      const jarvisLink = links.find(l => l.textContent.includes('Jarvis Voice'));
      if (jarvisLink) { jarvisLink.click(); return true; }
      return false;
    });
    
    if (clickedJarvis) {
      await new Promise(r => setTimeout(r, 1000));
      
      const drawerEl = await page.$('.drawer-panel');
      if (drawerEl) {
        await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_idle.png' });
      }

      // Click the CTA button
      const clickedCTA = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Press to Talk'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      
      if (clickedCTA) {
        await new Promise(r => setTimeout(r, 100));
        if (drawerEl) await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_listening.png' });
        
        await new Promise(r => setTimeout(r, 1500)); // wait for transcribing or thinking
        if (drawerEl) await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_thinking.png' });
        
        await new Promise(r => setTimeout(r, 2000)); // wait for speaking
        if (drawerEl) await drawerEl.screenshot({ path: 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_speaking.png' });
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
  }
}
run();
