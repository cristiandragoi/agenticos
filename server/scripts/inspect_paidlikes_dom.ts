import path from 'path';
import { chromium } from 'playwright';

async function inspect() {
  const profileDir = path.resolve('data', 'revenue-operator', 'profiles', 'profile_paidlikes_canary_account');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
  });

  const page = await context.newPage();
  console.log('Navigating to https://www.paidlikes.de/login ...');
  await page.goto('https://www.paidlikes.de/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('Login URL:', page.url());
  console.log('Login Title:', await page.title());

  const cookies = await context.cookies();
  console.log('All cookies:', cookies.map(c => ({ name: c.name, domain: c.domain, value: c.value.slice(0, 10) + '...' })));

  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('form');
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.name,
      id: i.id,
      type: i.type,
      placeholder: i.placeholder,
    }));
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
      text: (b as HTMLElement).innerText || (b as HTMLInputElement).value,
      type: b.getAttribute('type'),
    }));
    return {
      action: form?.action,
      inputs,
      buttons,
      bodyTextSnippet: document.body.innerText.slice(0, 500),
    };
  });

  console.log('Form details:', JSON.stringify(formInfo, null, 2));

  await context.close();
}

inspect().catch(err => {
  console.error('Inspection error:', err);
  process.exit(1);
});
