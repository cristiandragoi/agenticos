async function main() {
  const { browserOperator } = await import('../server/dist/services/browser/browserOperator.js');
  await browserOperator.openTarget('YouTube');
  const page = browserOperator.getPage();
  console.log('Opened YouTube');
  await page.goto('https://www.youtube.com/results?search_query=SEE+Adler+TV', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const items = await page.evaluate(() => {
    const res = [];
    const elements = document.querySelectorAll('ytd-channel-renderer, #channel-title, a[href*="/@"], ytd-video-renderer #video-title');
    for (const el of elements) {
      res.push({
        tag: el.tagName,
        text: (el.innerText || '').trim(),
        href: el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || ''
      });
    }
    return res.slice(0, 10);
  });
  console.log('FOUND ITEMS:', JSON.stringify(items, null, 2));
}

main().catch(err => console.error('ERR:', err));
