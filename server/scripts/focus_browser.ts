import { WindowsBrowserWindowHelper } from '../src/services/browser/browserSession.js';

const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
console.log('Chrome window inspection:', win);
if (win.windowHandle) {
  WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
  console.log('Brought Chrome to foreground!');
}
