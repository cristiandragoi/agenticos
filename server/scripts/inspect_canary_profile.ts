import path from 'path';
import { chromium } from 'playwright';

async function main() {
  const profileDir = path.resolve('data', 'revenue-operator', 'profiles', 'profile_paidlikes_canary_account');
  console.log(`[Profile Inspector] Inspecting profile at: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log('\n--- 1. PAIDLIKES AUTH CHECK ---');
  await page.goto('https://www.paidlikes.de/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const paidlikesUrl = page.url();
  const paidlikesTitle = await page.title();
  console.log(`URL: ${paidlikesUrl}`);
  console.log(`Title: ${paidlikesTitle}`);

  const logoutLink = await page.$('a[href*="logout"], a[href*="abmelden"]');
  const pointsEl = await page.$('#points, .points, .user-points, .user_points');
  const loginLink = await page.$('a[href="/login"], a[href*="login"]');
  const loginBtn = await page.$('button:has-text("Jetzt anmelden")');

  let paidlikesAuthed = false;
  let pointsText = '';

  if (logoutLink || pointsEl) {
    paidlikesAuthed = true;
    if (pointsEl) {
      pointsText = (await pointsEl.innerText()).trim();
    }
  } else if (!loginLink && !loginBtn && paidlikesUrl.includes('mitglieder')) {
    paidlikesAuthed = true;
  }

  console.log(`PaidLikes Authenticated: ${paidlikesAuthed ? 'YES' : 'NO'}`);
  if (pointsText) console.log(`Points displayed: ${pointsText}`);

  await page.screenshot({ path: path.resolve('data', 'revenue-operator', 'paidlikes_auth_check.png') });

  // If authenticated, check tasks page
  if (paidlikesAuthed) {
    console.log('\n--- INSPECTING PAIDLIKES TASKS PAGE ---');
    // Let's find any member area links
    const links = await page.$$eval('a', (els) => els.map((a) => ({ text: a.innerText.trim(), href: a.href })));
    const relevantLinks = links.filter((l) =>
      l.href.includes('mitglieder') ||
      l.href.includes('aktion') ||
      l.href.includes('like') ||
      l.href.includes('youtube') ||
      l.text.toLowerCase().includes('verdien') ||
      l.text.toLowerCase().includes('aktion')
    );
    console.log('Relevant member links found on page:', relevantLinks.slice(0, 15));
  } else {
    // If not authenticated, check what text is on the page
    const bodyText = await page.innerText('body').catch(() => '');
    console.log('Snippet of body:', bodyText.slice(0, 300));
  }

  console.log('\n--- 2. YOUTUBE / GOOGLE AUTH CHECK ---');
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const ytUrl = page.url();
  const ytTitle = await page.title();
  console.log(`YouTube URL: ${ytUrl}`);
  console.log(`YouTube Title: ${ytTitle}`);

  // Handle YouTube cookie consent if present
  const consentBtn = await page.$('button[aria-label*="Agree"], button[aria-label*="Zustimmen"], button:has-text("Alle akzeptieren"), button:has-text("Accept all")');
  if (consentBtn) {
    console.log('Found YouTube cookie consent dialog, clicking...');
    await consentBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const avatarBtn = await page.$('button#avatar-btn, ytd-topbar-menu-button-renderer img');
  const signInBtn = await page.$('a[aria-label*="Sign in"], a[aria-label*="Anmelden"], ytd-button-renderer:has-text("Sign in"), ytd-button-renderer:has-text("Anmelden")');

  const youtubeAuthed = avatarBtn !== null && signInBtn === null;
  console.log(`YouTube Authenticated: ${youtubeAuthed ? 'YES' : 'NO'}`);

  await page.screenshot({ path: path.resolve('data', 'revenue-operator', 'youtube_auth_check.png') });

  await context.close();
  console.log('\n[Profile Inspector] Inspection complete.');
}

main().catch((err) => {
  console.error('[Profile Inspector] Failed:', err);
  process.exit(1);
});
