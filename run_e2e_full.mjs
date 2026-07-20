import { _electron as electron } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

(async () => {
  let electronApp;
  try {
    console.log('Running DB migrations...');
    const dbPath = path.resolve('.agentos/runtime-tests/ui-real/test.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    execSync('npx drizzle-kit push', { 
      cwd: path.resolve('server'), 
      stdio: 'inherit',
      env: { ...process.env, AGENT_TEAMS_DB_PATH: dbPath }
    });

    console.log('Launching Electron...');
    electronApp = await electron.launch({ 
      args: ['.'],
      env: { ...process.env, AGENT_TEAMS_DB_PATH: dbPath }
    });
    electronApp.process().stdout.on('data', data => console.log('ELECTRON STDOUT:', data.toString().trim()));
    electronApp.process().stderr.on('data', data => console.error('ELECTRON STDERR:', data.toString().trim()));
    const window = await electronApp.firstWindow();

    console.log('App launched. Waiting for Agent Teams link...');
    window.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    await window.waitForSelector('text=Agent Teams', { timeout: 30000 });
    console.log('1. Clicking Agent Teams...');
    await window.click('text=Agent Teams');

    console.log('2. Clicking New Team...');
    await window.waitForSelector('text=New Team', { timeout: 10000 });
    await window.click('text=New Team');

    console.log('3. Filling form...');
    await window.waitForSelector('text=Goal / Prompt', { timeout: 10000 });
    await window.fill('textarea', 'Goal: Create the file status.txt with exactly this content: Agent Teams real runtime verified. Planner: Handoff to builder. Builder: Use the writeFile tool to write "Agent Teams real runtime verified." to the path "status.txt", then use the finish tool. Verifier: Use the readFile tool on "status.txt" to check the content, then use the finish tool. CRITICAL: For the teamsheet, `acceptanceCriteria` must be an array of strings. Do not generate nested objects for criteria! `status` must be omitted or one of: "pending", "running", "completed", "failed", "blocked".');

    console.log('4. Setting Workspace Path...');
    const absWsPath = path.resolve('.agentos/runtime-tests/ui-real/workspace');
    if (!fs.existsSync(absWsPath)) fs.mkdirSync(absWsPath, { recursive: true });
    
    // Ensure we clear the input before filling
    await window.locator('#workspacePathInput').fill('');
    await window.locator('#workspacePathInput').fill(absWsPath);

    console.log('5. Clicking Generate Team Strategy...');
    await window.click('text=Generate Team Strategy');

    console.log('6. Waiting for Strategy (TeamSheet)...');
    await window.waitForSelector('text=Proposed Team Structure', { timeout: 1200000 }); // Wait up to 20 minutes for Ollama to generate
    console.log('Team strategy generated successfully.');
    await window.screenshot({ path: 'teamsheet_preview.png' });
    console.log('Screenshot taken: teamsheet_preview.png');

    console.log('7. Saving to Dashboard...');
    await window.click('text=Save to Dashboard');

    console.log('8. Clicking on the new team card...');
    await window.waitForSelector('text=View Details', { timeout: 10000 });
    const cards = await window.locator('text=View Details').all();
    await cards[cards.length - 1].click();

    console.log('9. Approving and Launching...');
    await window.waitForSelector('text=Approve & Launch', { timeout: 10000 });
    await window.click('text=Approve & Launch');

    console.log('10. Capturing Planner running...');
    await window.waitForSelector('text=Agent Executing', { timeout: 60000 });
    await window.screenshot({ path: 'planner_running.png' });
    console.log('Screenshot taken: planner_running.png');

    console.log('11. Waiting for final completion (this may take up to 20 minutes)...');
    
    // Polling to take screenshots of other agents running
    let builderSeen = false;
    let verifierSeen = false;
    let completed = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 1200000) {
      if (await window.locator('text=Team Completed').count() > 0) {
        completed = true;
        break;
      }
      
      const html = await window.content();
      if (!builderSeen && html.includes('builder')) {
        await window.screenshot({ path: 'builder_running.png' });
        console.log('Screenshot taken: builder_running.png');
        builderSeen = true;
      }
      if (!verifierSeen && html.includes('verifier')) {
        await window.screenshot({ path: 'verifier_running.png' });
        console.log('Screenshot taken: verifier_running.png');
        verifierSeen = true;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    
    if (!completed) throw new Error('Timeout waiting for Team Completed');

    console.log('Team execution completed successfully.');
    await window.screenshot({ path: 'final_completed_team_page.png' });
    console.log('Screenshot taken: final_completed_team_page.png');
    
    // Artifact Panel
    console.log('12. Capturing Artifact Panel...');
    if (await window.locator('text=Artifacts').count() > 0) {
      const tabs = await window.locator('text=Artifacts').all();
      if (tabs.length > 0) {
          await tabs[0].click();
          await new Promise(r => setTimeout(r, 1000));
          await window.screenshot({ path: 'artifact_panel.png' });
          console.log('Screenshot taken: artifact_panel.png');
      }
    }
    
    // Verification Report
    console.log('13. Capturing Verification Report...');
    if (await window.locator('text=Verification Reports').count() > 0) {
      const tabs = await window.locator('text=Verification Reports').all();
      if (tabs.length > 0) {
          await tabs[0].click();
          await new Promise(r => setTimeout(r, 1000));
          await window.screenshot({ path: 'verification_report.png' });
          console.log('Screenshot taken: verification_report.png');
      }
    }

    console.log('\n--- PHYSICAL VERIFICATION ---');
    const wsDir = path.resolve('.agentos/runtime-tests/ui-real/workspace');
    const statusFile = path.join(wsDir, 'status.txt');
    if (fs.existsSync(statusFile)) {
      const stats = fs.statSync(statusFile);
      const content = fs.readFileSync(statusFile, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      console.log('File:', statusFile);
      console.log('Size:', stats.size, 'bytes');
      console.log('SHA-256:', hash);
      console.log('Content:', content);
    } else {
      console.error('File not found:', statusFile);
    }
    
    console.log('\n--- SQLITE DATABASE STATE ---');
    const db = require('better-sqlite3')(dbPath);
    console.log('TeamRuns:', db.prepare('SELECT id, status FROM teamRuns').all());
    console.log('Handoffs:', db.prepare('SELECT agentId, status, summary FROM agent_team_handoffs').all());
    console.log('Artifacts:', db.prepare('SELECT path, size, checksum FROM agent_team_artifacts').all());
    console.log('VerificationReports:', db.prepare('SELECT passed, evidence FROM verification_reports').all());

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
