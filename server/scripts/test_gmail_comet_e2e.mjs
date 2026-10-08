import { turnLifecycle } from '../dist/domains/turnLifecycle/controller.js';
import { emailService } from '../dist/services/email/EmailService.js';
import { observeWindows } from '../dist/domains/turnLifecycle/probes.js';
import { getActiveDesktopTask } from '../dist/domains/turnLifecycle/taskState.js';

async function main() {
  console.log('=== Step 1: Pre-check desktop windows ===');
  const preObs = await observeWindows();
  console.log(`Pre-check: foreground HWND=${preObs.foreground}, total windows=${preObs.windows.length}`);
  const cometWinPre = preObs.windows.find((w) => (w.process || '').toLowerCase() === 'comet');
  console.log('Existing Comet window:', cometWinPre ? `HWND ${cometWinPre.hwnd}, Title: ${cometWinPre.title}` : 'None');

  console.log('\n=== Step 2: Testing Turn 1 ===');
  const utterance1 = 'Öffne meine Gmail in Comet Perplexity und erstelle eine neue E-Mail.';
  console.log(`User says: "${utterance1}"`);
  
  const res1 = await turnLifecycle.submit({
    conversationId: 'test-conv-' + Date.now(),
    text: utterance1,
    source: 'voice',
    sttConfidence: 0.98,
  });

  console.log('\nTurn 1 Result:');
  console.log('Outcome:', res1.record?.outcome);
  console.log('Outcome reason:', res1.record?.outcomeReason);
  console.log('Response text:', res1.record?.responseText);

  const task = getActiveDesktopTask();
  console.log('Active desktop task:', task ? {
    type: task.type,
    requestedApp: task.requestedApp,
    hwnd: task.hwnd,
    title: task.windowTitle,
    composeOpened: task.composeOpened,
  } : 'None');

  const postObs1 = await observeWindows();
  console.log(`Post Turn 1: foreground HWND=${postObs1.foreground}`);
  const fgWin = postObs1.windows.find((w) => w.hwnd === postObs1.foreground);
  console.log('Foreground window is now:', fgWin ? `[${fgWin.process}] ${fgWin.title} (HWND ${fgWin.hwnd})` : 'Unknown');

  console.log('\n=== Step 3: Testing Turn 2 (Follow-up visibility check) ===');
  const utterance2 = 'Wo ist das? Ich sehe nichts.';
  console.log(`User says: "${utterance2}"`);

  const res2 = await turnLifecycle.submit({
    conversationId: res1.record?.request.conversationId || 'test-conv',
    text: utterance2,
    source: 'voice',
    sttConfidence: 0.95,
  });

  console.log('\nTurn 2 Result:');
  console.log('Outcome:', res2.record?.outcome);
  console.log('Outcome reason:', res2.record?.outcomeReason);
  console.log('Response text:', res2.record?.responseText);

  console.log('\n=== Verification Summary ===');
  const t1Ok = res1.record?.outcome === 'VERIFIED' && (res1.record?.responseText || '').includes('An wen soll die E-Mail gehen?');
  const t2Ok = res2.record?.outcome === 'VERIFIED' && ((res2.record?.responseText || '').includes('Comet') || (res2.record?.responseText || '').includes('Gmail'));
  console.log('Turn 1 Verified & Asked recipient:', t1Ok);
  console.log('Turn 2 Verified & Context retained:', t2Ok);

  process.exit(t1Ok && t2Ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
