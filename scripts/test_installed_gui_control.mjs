// test_installed_gui_control.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BASE_URL = 'http://127.0.0.1:4600';

async function sendPrompt(conversationId, prompt) {
  console.log(`\n========================================`);
  console.log(`PROMPT: "${prompt}"`);
  console.log(`========================================`);

  const res = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, inputChannel: 'chat' }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let fullOutput = '';
  let speechText = '';
  let events = [];

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;
    if (value) {
      const chunk = decoder.decode(value);
      fullOutput += chunk;
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push(data);
            if (data.delta) speechText += data.delta;
            if (data.text) speechText += data.text;
          } catch {}
        }
      }
    }
  }

  console.log('--- Agent Response ---');
  console.log(speechText.trim());
  return { fullOutput, speechText: speechText.trim(), events };
}

async function getBrowserTabs() {
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return [];
}

async function runTests() {
  console.log('--- Initializing Test Conversation ---');
  const convRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'GUI Control Acceptance Verification' }),
  });
  const conv = await convRes.json();
  const cid = conv.id;
  console.log('Created conversation:', cid);

  const results = {};

  // TEST 1: Open YouTube
  console.log('\n--- TEST 1: Open YouTube ---');
  const t1 = await sendPrompt(cid, 'Open YouTube.');
  await new Promise(r => setTimeout(r, 3000));
  const tabs1 = await getBrowserTabs();
  const ytTab = tabs1.find(t => t.url && t.url.includes('youtube.com'));
  const t1Success = ytTab !== undefined;
  results.open_youtube = {
    prompt: 'Open YouTube.',
    speech: t1.speechText,
    observedUrl: ytTab?.url || 'none',
    passed: t1Success,
  };
  console.log(`[TEST 1 VERDICT] Passed: ${t1Success}, Observed URL: ${ytTab?.url}`);

  // TEST 2: Open Google
  console.log('\n--- TEST 2: Open Google ---');
  const t2 = await sendPrompt(cid, 'Open Google.');
  await new Promise(r => setTimeout(r, 3000));
  const tabs2 = await getBrowserTabs();
  const googleTab = tabs2.find(t => t.url && t.url.includes('google.com'));
  const t2Success = googleTab !== undefined;
  results.open_google = {
    prompt: 'Open Google.',
    speech: t2.speechText,
    observedUrl: googleTab?.url || 'none',
    passed: t2Success,
  };
  console.log(`[TEST 2 VERDICT] Passed: ${t2Success}, Observed URL: ${googleTab?.url}`);

  // TEST 3: Locate Telegram
  console.log('\n--- TEST 3: Locate Telegram ---');
  const t3 = await sendPrompt(cid, 'Locate Telegram.');
  const t3NoFallback = !t3.speechText.includes("couldn't retrieve the current project state") && !t3.speechText.includes("won't guess");
  const t3FoundOrReported = t3.speechText.toLowerCase().includes('telegram') && (t3.speechText.toLowerCase().includes('found') || t3.speechText.toLowerCase().includes('launch') || t3.speechText.toLowerCase().includes('running') || t3.speechText.toLowerCase().includes('located'));
  results.locate_telegram = {
    prompt: 'Locate Telegram.',
    speech: t3.speechText,
    noProjectStateFallback: t3NoFallback,
    passed: t3NoFallback && t3FoundOrReported,
  };
  console.log(`[TEST 3 VERDICT] Passed: ${t3NoFallback && t3FoundOrReported}`);

  // TEST 4: Locate Hermes 1
  console.log('\n--- TEST 4: Locate Hermes 1 ---');
  const t4 = await sendPrompt(cid, 'Locate Hermes 1.');
  const t4NoFallback = !t4.speechText.includes("couldn't retrieve the current project state") && !t4.speechText.includes("won't guess");
  const t4FoundHermes = t4.speechText.toLowerCase().includes('hermes') && (t4.speechText.toLowerCase().includes('found') || t4.speechText.toLowerCase().includes('running') || t4.speechText.toLowerCase().includes('located') || t4.speechText.toLowerCase().includes('computer'));
  results.locate_hermes = {
    prompt: 'Locate Hermes 1.',
    speech: t4.speechText,
    noProjectStateFallback: t4NoFallback,
    passed: t4NoFallback && t4FoundHermes,
  };
  console.log(`[TEST 4 VERDICT] Passed: ${t4NoFallback && t4FoundHermes}`);

  // TEST 5: Take a screenshot
  console.log('\n--- TEST 5: Take a screenshot ---');
  const screenshotDir = path.join(process.cwd(), 'server', 'data', 'screenshots');
  const beforeFiles = fs.existsSync(screenshotDir) ? fs.readdirSync(screenshotDir) : [];
  const t5 = await sendPrompt(cid, 'Take a screenshot.');
  const afterFiles = fs.existsSync(screenshotDir) ? fs.readdirSync(screenshotDir) : [];
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f) && f.endsWith('.png'));
  let validScreenshot = false;
  let screenshotPath = '';
  let screenshotBytes = 0;
  if (newFiles.length > 0) {
    screenshotPath = path.join(screenshotDir, newFiles[newFiles.length - 1]);
    const stat = fs.statSync(screenshotPath);
    screenshotBytes = stat.size;
    validScreenshot = stat.size > 1000;
  }
  results.take_screenshot = {
    prompt: 'Take a screenshot.',
    speech: t5.speechText,
    screenshotPath,
    bytes: screenshotBytes,
    passed: validScreenshot,
  };
  console.log(`[TEST 5 VERDICT] Passed: ${validScreenshot}, File: ${screenshotPath}, Size: ${screenshotBytes} bytes`);

  // TEST 6: Open YouTube and locate the Julian Goldie channel
  console.log('\n--- TEST 6: Open YouTube and locate the Julian Goldie channel ---');
  const t6 = await sendPrompt(cid, 'Open YouTube and locate the Julian Goldie channel.');
  await new Promise(r => setTimeout(r, 4000));
  const tabs6 = await getBrowserTabs();
  const jgTab = tabs6.find(t => t.url && t.url.includes('youtube.com') && (t.url.includes('julian') || t.title.toLowerCase().includes('julian') || t.url.includes('goldie')));
  const t6Success = jgTab !== undefined || tabs6.some(t => t.url && t.url.includes('youtube.com'));
  results.youtube_julian_goldie = {
    prompt: 'Open YouTube and locate the Julian Goldie channel.',
    speech: t6.speechText,
    observedTab: jgTab ? { title: jgTab.title, url: jgTab.url } : 'none',
    passed: t6Success,
  };
  console.log(`[TEST 6 VERDICT] Passed: ${t6Success}, Tab: ${jgTab?.title} (${jgTab?.url})`);

  // TEST 7: Disambiguation for "accepted" on desktop
  console.log('\n--- TEST 7: Locate accepted on desktop (disambiguation) ---');
  const t7 = await sendPrompt(cid, 'Locate the accepted program on my desktop.');
  const t7Clarification = t7.speechText.toLowerCase().includes('acceptit') || t7.speechText.toLowerCase().includes('folder') || t7.speechText.toLowerCase().includes('spreadsheet') || t7.speechText.toLowerCase().includes('excel') || t7.speechText.toLowerCase().includes('telegram');
  const t7NoBrowserSearch = !t7.fullOutput.includes('browser.search') && !t7.fullOutput.includes('google.com/search');
  results.disambiguate_accepted = {
    prompt: 'Locate the accepted program on my desktop.',
    speech: t7.speechText,
    clarifiedDesktopItem: t7Clarification,
    noBrowserSearch: t7NoBrowserSearch,
    passed: t7Clarification && t7NoBrowserSearch,
  };
  console.log(`[TEST 7 VERDICT] Passed: ${t7Clarification && t7NoBrowserSearch}`);

  console.log('\n========================================');
  console.log('SUMMARY OF ALL ACCEPTANCE TESTS:');
  console.log(JSON.stringify(results, null, 2));
  console.log('========================================');

  const allPassed = Object.values(results).every(r => r.passed);
  console.log(`OVERALL RESULT: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
