const puppeteer = require('puppeteer');
const fs = require('fs');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const recorder = new PuppeteerScreenRecorder(page, {
    fps: 24,
    videoFrame: {
      width: 1280,
      height: 800,
    },
    aspectRatio: '16:9',
  });

  // Start recording
  await recorder.start('C:\\Users\\Cris\\.gemini\\antigravity\\brain\\f5fca1d9-e35e-4e53-bc80-f870e0bf93b1\\proof_jarvis_video.mp4');

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

      // Click Save to Memory
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const memoryBtn = btns.find(b => b.textContent.includes('Save to Memory'));
        if (memoryBtn) memoryBtn.click();
      });

      await new Promise(r => setTimeout(r, 1000));

      // Navigate to /runs
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('.nav-link'));
        const runsLink = links.find(l => l.textContent.includes('Runs'));
        if (runsLink) runsLink.click();
      });
      await new Promise(r => setTimeout(r, 4000));
      console.log("Screenshot runs");
    }
  }

  await new Promise(r => setTimeout(r, 1000));

  await recorder.stop();
  await browser.close();
  console.log("Video recording complete!");
})();
