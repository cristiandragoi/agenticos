# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: jarvis.spec.ts >> Jarvis Operational Workspace E2E Verification >> 1. Jarvis page renders correctly
- Location: e2e\jarvis.spec.ts:31:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Start Conversation' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('button', { name: 'Start Conversation' })

```

```yaml
- img "Agentic OS Logo"
- text: AGENTIC OS
- 'link "Gateway: OmniRoute (auto)"':
  - /url: http://localhost:20128/dashboard
- button "Minimize"
- button "Maximize"
- button "Close"
- img "Agentic OS Logo"
- heading "Agentic OS" [level=2]
- text: "Workspace: Main AI Agents"
- link "J.A.R.V.I.S.":
  - /url: "#/jarvis"
- link "Hermes":
  - /url: "#/hermes-studio"
- link "CodeX":
  - /url: "#/codex"
- text: Workspace
- link "Dashboard":
  - /url: "#/mission-control"
- link "Boards":
  - /url: "#/boards"
- link "Research":
  - /url: "#/research"
- text: Intelligence
- link "Memory":
  - /url: "#/memory"
- link "Models":
  - /url: "#/models"
- link "Skills":
  - /url: "#/skills"
- text: Execution
- link "Runs":
  - /url: "#/runs"
- link "Pipeline":
  - /url: "#/pipeline"
- text: Development
- link "Prompt Lab":
  - /url: "#/prompt-lab"
- link "Settings":
  - /url: "#/settings"
- text: Cockpit Online 0 pending
- button "Sync to Obsidian Vault Now" [disabled]
- text: 3 runtimes Search... ⌘K
- heading "Conversations" [level=2]
- button "New Conversation"
- text: New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation New Conversation
- heading "Jarvis Operational Workspace" [level=1]
- text: "You 08:58 AM build a Python script that prints hello world Intent routed to CODEX (Confidence: 95%) - Explicit software engineering request CodeX Goal initialized: goal-4b389258-. Generating plan..."
- button "Use Microphone"
- textbox "Message Input":
  - /placeholder: Ask Jarvis to orchestrate your workspace... (Shift+Enter for new line)
- button "Send Message" [disabled]
- heading "Context Inspector" [level=2]
- text: "Active Conversation New Conversation ID: conv-5e6c0115- System Status SYSTEMS NOMINAL Providers 1 / 1 Runtimes 1 / 1 Memory Reference Canonical Memory Ready"
```

# Test source

```ts
  1   | import { test, expect, Page } from '@playwright/test';
  2   | 
  3   | // The app uses HashRouter, so /jarvis is at /#/jarvis
  4   | const JARVIS_URL = '/#/jarvis';
  5   | 
  6   | test.use({ viewport: { width: 1400, height: 900 } });
  7   | 
  8   | async function waitForJarvis(page: Page) {
  9   |   await page.goto(JARVIS_URL, { waitUntil: 'load' });
  10  |   // Wait for the main header to appear (means React rendered)
  11  |   await expect(page.getByText('Jarvis Operational Workspace')).toBeVisible({ timeout: 15000 });
  12  | }
  13  | 
  14  | async function createConversation(page: Page) {
  15  |   // Try the empty-state "Start Conversation" button first
  16  |   const emptyStateBtn = page.getByRole('button', { name: 'Start Conversation' });
  17  |   const emptyVisible = await emptyStateBtn.isVisible();
  18  |   
  19  |   if (emptyVisible) {
  20  |     await emptyStateBtn.click();
  21  |   } else {
  22  |     // Use sidebar new-conversation button
  23  |     await page.getByRole('button', { name: 'New Conversation' }).click();
  24  |   }
  25  |   // Wait for the composer textarea to appear
  26  |   await page.waitForSelector('textarea[aria-label="Message Input"]', { timeout: 15000 });
  27  | }
  28  | 
  29  | test.describe('Jarvis Operational Workspace E2E Verification', () => {
  30  | 
  31  |   test('1. Jarvis page renders correctly', async ({ page }) => {
  32  |     await waitForJarvis(page);
  33  |     // Empty state title visible initially
> 34  |     await expect(page.getByRole('button', { name: 'Start Conversation' })).toBeVisible({ timeout: 10000 });
      |                                                                            ^ Error: expect(locator).toBeVisible() failed
  35  |   });
  36  | 
  37  |   test('2. Direct Jarvis conversation + refresh persistence', async ({ page }) => {
  38  |     await waitForJarvis(page);
  39  | 
  40  |     await createConversation(page);
  41  | 
  42  |     const input = page.locator('textarea[aria-label="Message Input"]');
  43  |     await expect(input).toBeVisible();
  44  | 
  45  |     // Send a direct chat message
  46  |     await input.fill('Hello Jarvis, what is 2+2?');
  47  |     await page.getByRole('button', { name: 'Send Message' }).click();
  48  | 
  49  |     // The user message should appear in the thread
  50  |     await expect(page.getByText('Hello Jarvis, what is 2+2?').first()).toBeVisible({ timeout: 5000 });
  51  | 
  52  |     // A routing event should appear for direct route
  53  |     await expect(page.locator('text=Intent routed to DIRECT')).toBeVisible({ timeout: 15000 });
  54  | 
  55  |     // Wait for assistant response  
  56  |     await page.waitForTimeout(3000);
  57  | 
  58  |     // Refresh and verify persistence
  59  |     await page.goto(JARVIS_URL, { waitUntil: 'load' });
  60  |     await expect(page.getByText('Jarvis Operational Workspace')).toBeVisible({ timeout: 10000 });
  61  |     // The conversation is restored after page reload (DB persisted)
  62  |     await expect(page.getByText('Hello Jarvis, what is 2+2?').first()).toBeVisible({ timeout: 15000 });
  63  |   });
  64  | 
  65  |   test('3. Intent routing: Hermes (unavailable) + Memory (unavailable)', async ({ page }) => {
  66  |     await waitForJarvis(page);
  67  |     await createConversation(page);
  68  |     
  69  |     const input = page.locator('textarea[aria-label="Message Input"]');
  70  | 
  71  |     // Hermes: project management request
  72  |     await input.fill('Show me the current project plan');
  73  |     await page.getByRole('button', { name: 'Send Message' }).click();
  74  |     await expect(page.locator('text=Intent routed to HERMES')).toBeVisible({ timeout: 15000 });
  75  |     await expect(page.locator('text=Hermes execution engine is currently offline')).toBeVisible({ timeout: 15000 });
  76  | 
  77  |     // Memory: recall request
  78  |     await input.fill('remember my preferences');
  79  |     await page.getByRole('button', { name: 'Send Message' }).click();
  80  |     await expect(page.locator('text=Intent routed to MEMORY')).toBeVisible({ timeout: 15000 });
  81  |     await expect(page.locator('text=Memory indexing service is currently offline')).toBeVisible({ timeout: 15000 });
  82  |   });
  83  | 
  84  |   test('4. Ambiguous intent: clarification request', async ({ page }) => {
  85  |     await waitForJarvis(page);
  86  |     await createConversation(page);
  87  |     
  88  |     const input = page.locator('textarea[aria-label="Message Input"]');
  89  | 
  90  |     // Very short / ambiguous prompt -> clarification_required
  91  |     await input.fill('do it');
  92  |     await page.getByRole('button', { name: 'Send Message' }).click();
  93  |     
  94  |     // Should get a clarification response
  95  |     await expect(page.locator('text=clarify')).toBeVisible({ timeout: 15000 });
  96  |   });
  97  | 
  98  |   test('5. CodeX routing: goal creation + routing event', async ({ page }) => {
  99  |     await waitForJarvis(page);
  100 |     await createConversation(page);
  101 |     
  102 |     const input = page.locator('textarea[aria-label="Message Input"]');
  103 | 
  104 |     await input.fill('build a Python script that prints hello world');
  105 |     await page.getByRole('button', { name: 'Send Message' }).click();
  106 | 
  107 |     // Routing event for CodeX
  108 |     await expect(page.locator('text=Intent routed to CODEX')).toBeVisible({ timeout: 15000 });
  109 | 
  110 |     // CodeX goal initialization message from orchestrator
  111 |     await expect(page.locator('text=CodeX Goal initialized')).toBeVisible({ timeout: 15000 });
  112 |   });
  113 | });
  114 | 
```