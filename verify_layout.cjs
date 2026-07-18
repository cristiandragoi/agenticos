const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:5173/#/codex');
  await page.goto('http://localhost:5173/#/codex', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const artifactsDir = process.env.ARTIFACTS_DIR || process.cwd();

  // 1. Screenshot empty state
  const emptyStatePath = path.join(artifactsDir, 'studio_empty_state_final.png');
  await page.screenshot({ path: emptyStatePath });
  console.log('Saved screenshot:', emptyStatePath);

  // 2. Validate layout
  const sidebar = page.locator('[data-testid="studio-sidebar"]');
  const workspace = page.locator('[data-testid="studio-workspace"]');
  const inspector = page.locator('[data-testid="studio-inspector"]');
  const drawer = page.locator('[data-testid="studio-drawer"]');

  const sidebarBox = await sidebar.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  const drawerBox = await drawer.boundingBox();

  console.log('--- COMPUTED LAYOUT ---');
  console.log('Viewport: 1440x900');
  console.log('Sidebar:', sidebarBox);
  console.log('Workspace:', workspaceBox);
  console.log('Inspector:', inspectorBox);
  console.log('Drawer:', drawerBox);

  let passed = true;
  try {
    if (sidebarBox.width <= 200) throw new Error('Sidebar width too small');
    if (workspaceBox.width <= 500) throw new Error('Workspace width too small');
    if (inspectorBox.width <= 250) throw new Error('Inspector width too small');
    if (drawerBox.height <= 150) throw new Error('Drawer height too small');
    if (inspectorBox.x <= workspaceBox.x) throw new Error('Inspector is not to the right of workspace');
    if (drawerBox.y <= workspaceBox.y) throw new Error('Drawer is not below workspace');
    console.log('Playwright layout test passed!');
  } catch (e) {
    console.error('Playwright layout test failed:', e.message);
    passed = false;
  }

  // 3. Screenshot populated board
  // Click the first goal in the sidebar history or active goals
  try {
    const goals = await page.locator('[data-testid="studio-sidebar"] button').all();
    if (goals.length > 1) { // 0 is 'New Goal'
      await goals[1].click();
      await page.waitForTimeout(1000);
      
      // Click Board tab
      await page.click('text="Board"');
      await page.waitForTimeout(500);
      
      const boardPath = path.join(artifactsDir, 'studio_populated_board.png');
      await page.screenshot({ path: boardPath });
      console.log('Saved screenshot:', boardPath);
    }
  } catch(e) {
    console.log('Could not populate board screenshot', e);
  }

  // 4. Screenshot inspector
  const inspectorPath = path.join(artifactsDir, 'studio_inspector.png');
  await inspector.screenshot({ path: inspectorPath });
  console.log('Saved screenshot:', inspectorPath);

  // 5. Screenshot open bottom drawer
  const drawerPath = path.join(artifactsDir, 'studio_bottom_drawer.png');
  await drawer.screenshot({ path: drawerPath });
  console.log('Saved screenshot:', drawerPath);

  await browser.close();
  process.exit(passed ? 0 : 1);
})();
