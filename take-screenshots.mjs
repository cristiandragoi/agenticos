import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Navigate to CodeX Studio
  await page.goto('http://localhost:5173/codex');
  await page.waitForTimeout(2000); // Wait for load
  await page.screenshot({ path: 'screenshot_empty.png' });
  
  // Emulate clicking on the test goal
  // Assuming the goal is rendered in the Studio sidebar or something... wait, my script doesn't know how to click the sidebar to load the goal.
  // Can we navigate directly to the goal via URL? e.g. /codex/goal-7129534c-
  await page.goto('http://localhost:5173/codex?goalId=goal-7129534c-');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_completed.png' });

  await browser.close();
})();
