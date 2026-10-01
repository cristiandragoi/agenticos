import { chromium } from 'playwright';
import path from 'path';
import { execFileSync } from 'child_process';

async function testBrowserWindow() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser-test');
  console.log('Launching browser with profileDir:', profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--restore-last-session=false',
      '--remote-debugging-port=9223',
    ],
    viewport: null,
  });

  const out = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
  ], { encoding: 'utf8' }).trim();
  const cdpPid = parseInt(out, 10);
  console.log('Listening PID on 9223:', cdpPid);

  const psInspect = `
$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinFinder {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    public static void Check(int targetPid) {
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(h, out pid);
            if (pid == targetPid) {
                StringBuilder sb = new StringBuilder(512);
                GetWindowText(h, sb, 512);
                Console.WriteLine("FOUND_WINDOW:" + h.ToInt64() + ":" + sb.ToString());
            }
            return true;
        }, IntPtr.Zero);
    }
}
'@
Add-Type -TypeDefinition $csharp
[WinFinder]::Check(${cdpPid})
`;
  const inspectOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', psInspect], { encoding: 'utf8' });
  console.log('Inspect output:\n', inspectOut);

  await new Promise((r) => setTimeout(r, 3000));
  await context.close();
}

testBrowserWindow().catch(console.error);
