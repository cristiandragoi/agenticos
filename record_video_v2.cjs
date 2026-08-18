const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--window-size=1280,800'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const recorder = new PuppeteerScreenRecorder(page, {
      fps: 24,
      videoFrame: { width: 1280, height: 800 },
      aspectRatio: '16:9',
    });

    await recorder.start('C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_video.mp4');

    console.log("Navigating to app...");
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 4000));
    
    console.log("Opening Jarvis Voice...");
    const clickedJarvis = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.nav-link'));
      const jarvisLink = links.find(l => l.textContent.includes('Jarvis Voice'));
      if (jarvisLink) { jarvisLink.click(); return true; }
      return false;
    });
    
    if (clickedJarvis) {
      await new Promise(r => setTimeout(r, 1000));

      console.log("Clicking Press to Talk...");
      const clickedCTA = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Press to Talk'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      
      if (clickedCTA) {
        console.log("Started listening...");

        console.log("Waiting 3s for auto-stop...");
        await new Promise(r => setTimeout(r, 3000));
        console.log("Waiting for STT and processing (10s)...");
        await new Promise(r => setTimeout(r, 10000));

        console.log("Clicking Save to Memory...");
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const memoryBtn = btns.find(b => b.textContent.includes('Save to Memory'));
          if (memoryBtn) memoryBtn.click();
        });

        await new Promise(r => setTimeout(r, 1000));

        console.log("Navigating to /runs...");
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('.nav-link'));
          const runsLink = links.find(l => l.textContent.includes('Runs'));
          if (runsLink) runsLink.click();
        });
        await new Promise(r => setTimeout(r, 4000));
        console.log("Done. Finishing recording.");
      } else {
        console.log("CTA not found.");
      }
    } else {
      console.log("Jarvis Voice link not found.");
    }

  } catch (error) {
    console.error("Error during recording:", error);
  } finally {
    try { await recorder.stop(); } catch (e) {}
    console.log("Video recording complete!");
    if (browser) {
      await browser.close();
    }
  }
})();
