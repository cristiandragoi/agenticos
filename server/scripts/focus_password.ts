import { chromium } from 'playwright';
import { WindowsBrowserWindowHelper } from '../src/services/browser/browserSession.js';

async function focusPassword() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('accounts.google.com'));
  if (page) {
    const pwdInput = page.locator('input[type="password"]').first();
    if (await pwdInput.isVisible()) {
      await pwdInput.focus();
    }
  }

  const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  if (win.windowHandle) {
    WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
    console.log('Focused password input and brought Chrome window to foreground!');
  }
}

focusPassword().catch(console.error);
