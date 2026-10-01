import { chromium } from 'playwright';

async function checkAllTabsAndCookies() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  for (const ctx of browser.contexts()) {
    console.log('--- Context ---');
    for (const page of ctx.pages()) {
      console.log('Page URL:', page.url(), 'Title:', await page.title());
    }
    const cookies = await ctx.cookies();
    const fcCookies = cookies.filter(c => c.domain.includes('freecash'));
    console.log(`Freecash cookies count: ${fcCookies.length}`);
    for (const c of fcCookies) {
      console.log(` - ${c.name} = ${c.value.slice(0, 15)}... (domain: ${c.domain}, httpOnly: ${c.httpOnly})`);
    }
    const googleCookies = cookies.filter(c => c.domain.includes('google'));
    console.log(`Google cookies count: ${googleCookies.length}`);
  }
}

checkAllTabsAndCookies().catch(console.error);
