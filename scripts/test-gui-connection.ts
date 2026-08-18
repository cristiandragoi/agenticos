import { _electron as electron } from 'playwright';

async function main() {
  console.log('Connecting to packaged Electron app...');
  const electronApp = await electron.launch({
    executablePath: 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe'
  });

  const window = await electronApp.firstWindow();
  console.log('Window title:', await window.title());
  console.log('Window URL:', window.url());

  // Inspect page elements
  await window.waitForLoadState('domcontentloaded');
  const buttons = await window.$$eval('button', (els) => els.map((b) => b.innerText || b.getAttribute('aria-label') || b.getAttribute('title')));
  console.log('Found buttons:', buttons.slice(0, 10));

  await electronApp.close();
}

main().catch(console.error);
