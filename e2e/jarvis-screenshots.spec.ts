/**
 * Jarvis UI Evidence — screenshot capture test
 * Run: npx playwright test e2e/jarvis-screenshots.spec.ts --reporter=list
 */
import { test, expect, Page } from '@playwright/test';
import path from 'path';

const JARVIS_URL = '/#/jarvis';
const ARTIFACT_DIR = 'C:/Users/Cris/.gemini/antigravity/brain/daeb0620-8470-4c90-9551-eb2877a836e8';

async function waitForJarvis(page: Page) {
  await page.goto(JARVIS_URL, { waitUntil: 'load' });
  await expect(page.getByText('Jarvis Operational Workspace')).toBeVisible({ timeout: 15000 });
}

async function createConversation(page: Page) {
  const emptyBtn = page.getByRole('button', { name: 'Start Conversation' });
  const isVisible = await emptyBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (isVisible) {
    await emptyBtn.click();
  } else {
    await page.getByRole('button', { name: 'New Conversation' }).click();
  }
  await page.waitForSelector('textarea[aria-label="Message Input"]', { timeout: 15000 });
}

test.use({ viewport: { width: 1400, height: 900 } });

test('UI Screenshots', async ({ page }) => {
  // 1. Empty state
  await waitForJarvis(page);
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_01_empty_state.png` });

  // 2. Create conversation - active conversation
  await createConversation(page);
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_02_conversation_created.png` });

  // 3. Send a direct message
  const input = page.locator('textarea[aria-label="Message Input"]');
  await input.fill('Hello Jarvis, what is the time?');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await page.locator('text=Intent routed to DIRECT').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_03_direct_chat.png` });

  // 4. Hermes unavailable
  await input.fill('Show me the current project plan');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await page.locator('text=Hermes execution engine is currently offline').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_04_hermes_unavailable.png` });

  // 5. Memory unavailable
  await input.fill('remember my preferences');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await page.locator('text=Memory indexing service is currently offline').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_05_memory_unavailable.png` });

  // 6. CodeX routing
  await input.fill('build a Python hello world script');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await page.locator('text=Intent routed to CODEX').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_06_codex_routing.png` });

  // 7. Refresh and restored conversation
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${ARTIFACT_DIR}/ui_07_restored_conversation.png` });
});
