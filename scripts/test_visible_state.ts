import { browserOperator } from '../server/dist/services/browser/browserOperator.js';
import { browserSessionManager, WindowsBrowserWindowHelper } from '../server/dist/services/browser/browserSession.js';
import { browserSessionAuthority } from '../server/dist/services/browser/browserSessionAuthority.js';
import { execSync } from 'child_process';

async function testVisibleState() {
  console.log('1. Ensuring visible browser...');
  await browserOperator.ensureBrowser('VISIBLE_USER_BROWSER');
  
  // Get listening PID on 9223
  let cdpPid = 0;
  try {
    const raw = execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"').toString().trim();
    cdpPid = parseInt(raw, 10);
  } catch {}
  console.log('Chrome CDP PID on 9223:', cdpPid);

  console.log('2. Navigating to https://www.google.com ...');
  const navRes = await browserOperator.openTarget('https://www.google.com', {
    conversationId: 'test-conv',
  });
  console.log('Nav result:', navRes.success, navRes.url, navRes.spokenText);

  // Inspect state
  const session = browserSessionManager.getSession();
  console.log('Session manager:', session);

  // Let's inspect all top-level windows right now
  const psEnum = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInspector {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
$winsta = [WinInspector]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinInspector]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinInspector]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinInspector]::SetThreadDesktop($desk) | Out-Null }
$fg = [WinInspector]::GetForegroundWindow()

[WinInspector]::EnumDesktopWindows($desk, {
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [WinInspector]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t.Length -gt 0 -and [WinInspector]::IsWindowVisible($h)) {
        $wPid = 0
        [WinInspector]::GetWindowThreadProcessId($h, [ref]$wPid) | Out-Null
        $proc = Get-Process -Id $wPid -ErrorAction SilentlyContinue
        $pName = if ($proc) { $proc.ProcessName } else { "unknown" }
        if ($pName -match "chrome|edge") {
            $isMin = [WinInspector]::IsIconic($h)
            $isFg = ($h -eq $fg)
            Write-Host "HWND: $($h.ToInt64()) PID: $wPid ($pName) Vis: True Min: $isMin Fg: $isFg Title: '$t'"
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
  const psOut = execSync(`powershell -NoProfile -Command "${psEnum.replace(/"/g, '\\"')}"`).toString();
  console.log('Visible Windows for Chrome/Edge:\n', psOut);

  // Now inspect page via Playwright evaluate
  const page = (browserOperator as any).activePage;
  if (page) {
    const docVis = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      title: document.title,
      url: window.location.href,
    }));
    console.log('Page DOM evaluate:', docVis);
  }

  // Now navigate to YouTube
  console.log('\n3. Navigating to https://www.youtube.com ...');
  const ytRes = await browserOperator.openTarget('https://www.youtube.com', {
    conversationId: 'test-conv',
  });
  console.log('YT result:', ytRes.success, ytRes.url, ytRes.spokenText);

  const psOutYt = execSync(`powershell -NoProfile -Command "${psEnum.replace(/"/g, '\\"')}"`).toString();
  console.log('Visible Windows after YouTube:\n', psOutYt);

  if (page) {
    const docVisYt = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      title: document.title,
      url: window.location.href,
    }));
    console.log('Page DOM evaluate after YouTube:', docVisYt);
  }

  const winInspect = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('WindowsBrowserWindowHelper.inspectWindow(undefined, "Chrome"):', winInspect);
  process.exit(0);
}

testVisibleState().catch((err) => {
  console.error(err);
  process.exit(1);
});
