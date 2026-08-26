const { _electron: electron } = require('playwright');

(async () => {
  console.log('Launching Agentic OS...');
  const app = await electron.launch({
    executablePath: 'B:\\AgenticOS\\release\\win-unpacked\\Agentic OS.exe'
  });

  const page = await app.firstWindow();
  console.log('Window loaded.');
  
  await page.waitForTimeout(5000);
  const inputSelector = '[placeholder*="Ask Jarvis anything"]';
  await page.waitForSelector(inputSelector);
  
  for (let i = 1; i <= 5; i++) {
    console.log('Sending DIRECT request ' + i);
    await page.fill(inputSelector, 'Hello ' + i);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000); // wait for completion
  }
  
  console.log('Sending long request...');
  await page.fill(inputSelector, 'Explain in two sentences what the current role of Jarvis is inside Agentic OS. Please wait 50 seconds before replying.');
  await page.keyboard.press('Enter');
  
  let time = 0;
  while (time < 90) {
    await page.waitForTimeout(10000);
    time += 10;
    console.log('Waited ' + time + 's...');
    const body = await page.innerHTML('body');
    if (body.includes('Could not reach the backend') || body.includes('aborted') || body.includes('Backend connection timed out')) {
      console.error('ERROR DETECTED: stream aborted!');
      await app.close();
      process.exit(1);
    }
  }
  
  console.log('Done.');
  await app.close();
})();
