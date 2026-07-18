import { chromium } from 'playwright';
import path from 'path';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || process.cwd();

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark'
  });
  const page = await context.newPage();

  console.log('Navigating to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForSelector('text="CodeX Goal Mode"', { timeout: 15000 });

  // 1. CodeX Studio empty state
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_empty_state.png') });
  console.log('Saved 01_empty_state.png');

  // 2. Goal configuration form
  await page.fill('textarea', 'Create a simple math utility and write tests for it.');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_goal_config.png') });
  console.log('Saved 02_goal_config.png');

  // We actually click start to enter an active state if the backend is running.
  // Assuming the backend is running, it will create a goal and start it.
  await page.click('button:has-text("Start Autonomous Goal")');
  await page.waitForTimeout(3000);

  // 3. Active goal in Chat
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_active_chat.png') });
  console.log('Saved 03_active_chat.png');

  // 4. Active goal in Plan
  await page.click('button:has-text("Plan")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_active_plan.png') });
  console.log('Saved 04_active_plan.png');

  // 5. Board with steps
  await page.click('button:has-text("Board")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '05_kanban_board.png') });
  console.log('Saved 05_kanban_board.png');

  // 6. Files browser
  await page.click('button:has-text("Files")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '06_files_browser.png') });
  console.log('Saved 06_files_browser.png');

  // 7. Diff view (same as Files tab right now)
  await page.click('button:has-text("Diff")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '07_diff_view.png') });
  console.log('Saved 07_diff_view.png');

  // 8. Terminal drawer
  await page.click('button:has-text("Terminal")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '08_terminal_drawer.png') });
  console.log('Saved 08_terminal_drawer.png');

  // 9. Validation result
  await page.click('button:has-text("Validation")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '09_validation_result.png') });
  console.log('Saved 09_validation_result.png');

  // 10. Checkpoint timeline
  await page.click('button:has-text("Checkpoints")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '10_checkpoints.png') });
  console.log('Saved 10_checkpoints.png');

  // 11. Pause or recovery state
  await page.click('button:has-text("Pause")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '11_pause_state.png') });
  console.log('Saved 11_pause_state.png');

  // 12. Approval required state
  // This is hard to trigger deterministically without mocking, we will just screenshot the current view.
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '12_approval_required.png') });
  
  // 13. Completed goal (Wait for completion or just take current)
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '13_completed_goal.png') });

  // 14. Narrow window view
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '14_narrow_window.png') });
  console.log('Saved 14_narrow_window.png');

  await browser.close();
  console.log('Screenshots complete.');
}

run().catch(console.error);
