import { _electron as electron } from 'playwright';
import { test, expect } from '@playwright/test';

test('Agent Teams End-to-End Workflow', async () => {
  // Launch Electron app
  const electronApp = await electron.launch({ args: ['.'] });

  // Evaluation of first window
  const window = await electronApp.firstWindow();

  console.log('App launched.');

  // 1. Wait for navigation sidebar and click "Agent Teams"
  await window.waitForSelector('text=Agent Teams', { timeout: 10000 });
  await window.click('text=Agent Teams');
  console.log('Navigated to Agent Teams');

  // 2. Click "Create Team" or "New Team"
  // The empty state says "Create Team", the top button says "New Team"
  await window.waitForSelector('text=New Team');
  await window.click('text=New Team');
  console.log('Clicked New Team');

  // 3. Fill the form
  await window.waitForSelector('text=Goal / Prompt');
  await window.fill('textarea[placeholder*="Describe the complex task"]', 'Build a simple tic-tac-toe in python');
  
  // 4. Click "Generate Team Strategy"
  await window.click('text=Generate Team Strategy');
  console.log('Clicked Generate Team Strategy');

  // 5. Wait for the Coordinator to return a preview (TeamSheetMap will render 'Proposed Team Structure')
  await window.waitForSelector('text=Proposed Team Structure', { timeout: 30000 });
  console.log('Team strategy generated successfully.');

  // 6. Click "Save to Dashboard"
  await window.click('text=Save to Dashboard');
  console.log('Saved to Dashboard');

  // 7. Click on the new team card to open TeamDetailView
  // The card should contain "Build a simple tic-tac-toe"
  await window.waitForSelector('text=Build a simple tic-tac-toe', { timeout: 5000 });
  await window.click('text=Build a simple tic-tac-toe');
  console.log('Navigated to Team Detail View');

  // 8. Click "Approve & Launch"
  await window.waitForSelector('text=Approve & Launch', { timeout: 5000 });
  await window.click('text=Approve & Launch');
  console.log('Clicked Approve & Launch');

  // 9. Verify Timeline updates live.
  // The status should change to running, and Timeline should show "Agent Executing"
  await window.waitForSelector('text=Agent Executing', { timeout: 15000 });
  console.log('Timeline updated to Agent Executing');

  await electronApp.close();
});
