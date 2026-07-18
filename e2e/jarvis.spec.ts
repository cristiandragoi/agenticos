import { test, expect, Page } from '@playwright/test';

// The app uses HashRouter, so /jarvis is at /#/jarvis
const JARVIS_URL = '/#/jarvis';

test.use({ viewport: { width: 1400, height: 900 } });

async function waitForJarvis(page: Page) {
  await page.goto(JARVIS_URL, { waitUntil: 'load' });
  // Wait for the main header to appear (means React rendered)
  await expect(page.getByText('Jarvis Operational Workspace')).toBeVisible({ timeout: 15000 });
}

async function createConversation(page: Page) {
  // Try the empty-state "Start Conversation" button first
  const emptyStateBtn = page.getByRole('button', { name: 'Start Conversation' });
  const emptyVisible = await emptyStateBtn.isVisible();
  
  if (emptyVisible) {
    await emptyStateBtn.click();
  } else {
    // Use sidebar new-conversation button
    await page.getByRole('button', { name: 'New Conversation' }).click();
  }
  // Wait for the composer textarea to appear
  await page.waitForSelector('textarea[aria-label="Message Input"]', { timeout: 15000 });
}

test.describe('Jarvis Operational Workspace E2E Verification', () => {

  test('1. Jarvis page renders correctly', async ({ page }) => {
    await waitForJarvis(page);
    // Empty state title visible initially
    await expect(page.getByRole('button', { name: 'Start Conversation' })).toBeVisible({ timeout: 10000 });
  });

  test('2. Direct Jarvis conversation + refresh persistence', async ({ page }) => {
    await waitForJarvis(page);

    await createConversation(page);

    const input = page.locator('textarea[aria-label="Message Input"]');
    await expect(input).toBeVisible();

    // Send a direct chat message
    await input.fill('Hello Jarvis, what is 2+2?');
    await page.getByRole('button', { name: 'Send Message' }).click();

    // The user message should appear in the thread
    await expect(page.getByText('Hello Jarvis, what is 2+2?').first()).toBeVisible({ timeout: 5000 });

    // A routing event should appear for direct route
    await expect(page.locator('text=Intent routed to DIRECT')).toBeVisible({ timeout: 15000 });

    // Wait for assistant response  
    await page.waitForTimeout(3000);

    // Refresh and verify persistence
    await page.goto(JARVIS_URL, { waitUntil: 'load' });
    await expect(page.getByText('Jarvis Operational Workspace')).toBeVisible({ timeout: 10000 });
    // The conversation is restored after page reload (DB persisted)
    await expect(page.getByText('Hello Jarvis, what is 2+2?').first()).toBeVisible({ timeout: 15000 });
  });

  test('3. Intent routing: Hermes (unavailable) + Memory (unavailable)', async ({ page }) => {
    await waitForJarvis(page);
    await createConversation(page);
    
    const input = page.locator('textarea[aria-label="Message Input"]');

    // Hermes: project management request
    await input.fill('Show me the current project plan');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.locator('text=Intent routed to HERMES')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Hermes execution engine is currently offline')).toBeVisible({ timeout: 15000 });

    // Memory: recall request
    await input.fill('remember my preferences');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.locator('text=Intent routed to MEMORY')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Memory indexing service is currently offline')).toBeVisible({ timeout: 15000 });
  });

  test('4. Ambiguous intent: clarification request', async ({ page }) => {
    await waitForJarvis(page);
    await createConversation(page);
    
    const input = page.locator('textarea[aria-label="Message Input"]');

    // Very short / ambiguous prompt -> clarification_required
    await input.fill('do it');
    await page.getByRole('button', { name: 'Send Message' }).click();
    
    // Should get a clarification response
    await expect(page.locator('text=clarify')).toBeVisible({ timeout: 15000 });
  });

  test('5. CodeX routing: goal creation + routing event', async ({ page }) => {
    await waitForJarvis(page);
    await createConversation(page);
    
    const input = page.locator('textarea[aria-label="Message Input"]');

    await input.fill('build a Python script that prints hello world');
    await page.getByRole('button', { name: 'Send Message' }).click();

    // Routing event for CodeX
    await expect(page.locator('text=Intent routed to CODEX')).toBeVisible({ timeout: 15000 });

    // CodeX goal initialization message from orchestrator
    await expect(page.locator('text=CodeX Goal initialized')).toBeVisible({ timeout: 15000 });
  });
});
