import { _electron as electron } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

(async () => {
  let electronApp;
  try {
    console.log('Running DB migrations...');
    const dbPath = path.resolve('.agentos/runtime-tests/ui-real/test.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    execSync('npx drizzle-kit push', { 
      cwd: path.resolve('server'), 
      stdio: 'inherit',
      env: {
        ...process.env,
        AGENT_TEAMS_DB_PATH: dbPath
      }
    });

    console.log('Launching Electron...');
    electronApp = await electron.launch({ 
      args: ['.'],
      env: {
        ...process.env,
        AGENT_TEAMS_DB_PATH: dbPath
      }
    });
    electronApp.process().stdout.on('data', data => console.log('ELECTRON STDOUT:', data.toString().trim()));
    electronApp.process().stderr.on('data', data => console.error('ELECTRON STDERR:', data.toString().trim()));
    const window = await electronApp.firstWindow();

    console.log('App launched. Waiting for Agent Teams link...');
    window.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    try {
      await window.waitForSelector('text=Agent Teams', { timeout: 30000 });
    } catch (err) {
      console.log('Failed to find Agent Teams. Current HTML:');
      console.log(await window.content());
      throw err;
    }
    
    console.log('1. Clicking Agent Teams...');
    await window.click('text=Agent Teams');

    console.log('2. Clicking New Team...');
    await window.waitForSelector('text=New Team', { timeout: 10000 });
    await window.click('text=New Team');

    console.log('3. Filling form...');
    await window.waitForSelector('text=Goal / Prompt', { timeout: 10000 });
    await window.fill('textarea', 'Create the file: status.txt with exactly this content: Agent Teams real runtime verified');

    console.log('4. Setting Workspace Path...');
    const inputs = await window.locator('input[type="text"]').all();
    if (inputs.length > 0) {
      await inputs[inputs.length - 1].fill('.agentos/runtime-tests/ui-real/workspace');
    }

    console.log('5. Clicking Generate Team Strategy...');
    await window.click('text=Generate Team Strategy');

    console.log('6. Waiting for Strategy (TeamSheet)...');
    await window.waitForSelector('text=Proposed Team Structure', { timeout: 600000 });
    console.log('Team strategy generated successfully.');

    console.log('7. Saving to Dashboard...');
    await window.click('text=Save to Dashboard');

    console.log('8. Clicking on the new team card...');
    await window.waitForSelector('text=View Details', { timeout: 10000 });
    const cards = await window.locator('text=View Details').all();
    // Click the LAST team card because the newest team is appended
    await cards[cards.length - 1].click();

    console.log('9. Approving and Launching...');
    await window.waitForSelector('text=Approve & Launch', { timeout: 10000 });
    await window.click('text=Approve & Launch');

    console.log('10. Verifying Timeline...');
    await window.waitForSelector('text=Agent Executing', { timeout: 30000 });
    console.log('Timeline updated successfully.');

    console.log('11. Waiting for final completion...');
    await window.waitForSelector('text=Team Completed', { timeout: 1800000 }); // 30 mins
    console.log('Team execution completed successfully.');

    console.log('All steps succeeded.');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    if (electronApp) {
      await electronApp.close();
    }
  }
})();
