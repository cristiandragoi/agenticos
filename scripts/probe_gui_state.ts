import { _electron as electron } from 'playwright';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

async function probe() {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(page.url().split('#')[0] + '#/jarvis');
  await new Promise(r => setTimeout(r, 3000));

  const ta = page.locator('textarea[aria-label="Message Input"]');
  await ta.fill('Jarvis, open YouTube.');
  await ta.press('Enter');

  console.log('Waiting for completion...');
  // Wait until cancel button disappears
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const cancelCount = await page.locator('button:has-text("STOP"), button:has-text("Cancel")').count();
    const rows = await page.locator('[class*="messageRow"]').allInnerTexts().catch(() => []);
    console.log(`[SEC ${i+1}] cancelCount=${cancelCount}, rowsCount=${rows.length}`);
    if (rows.length > 1 && cancelCount === 0) {
      console.log('DONE! ROWS:');
      for (const row of rows) {
        console.log('--- ROW: ---', row.slice(0, 150));
      }
      break;
    }
  }

  await app.close();
}

probe().catch(console.error);
