import { chromium } from 'playwright';

async function inspectGoogleButton() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) return;

  const btnHtml = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a')).filter(el => el.textContent?.includes('Google'));
    return btns.map(b => ({
      tagName: b.tagName,
      text: b.textContent?.trim(),
      href: (b as HTMLAnchorElement).href || null,
      outerHTML: b.outerHTML
    }));
  });

  console.log('GOOGLE BUTTONS:', JSON.stringify(btnHtml, null, 2));
}

inspectGoogleButton().catch(console.error);
