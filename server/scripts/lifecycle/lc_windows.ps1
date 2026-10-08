# Read-only probe: visible top-level windows + current foreground window.
# Output: JSON { foreground: <hwnd>, windows: [ { hwnd, pid, process, title } ] }
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Runtime.InteropServices;

public class LcWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr hDesktop);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr hDesktop);

  public static void Query(out long foregroundHwnd, out List<object[]> windows) {
    long fg = 0;
    var list = new List<object[]>();

    Thread t = new Thread(() => {
      IntPtr hDesk = OpenDesktop("default", 0, false, 0x01FF);
      if (hDesk != IntPtr.Zero) {
        SetThreadDesktop(hDesk);
      }
      try {
        IntPtr fgPtr = GetForegroundWindow();
        fg = fgPtr.ToInt64();

        EnumWindows((h, l) => {
          if (!IsWindowVisible(h)) return true;
          var sb = new StringBuilder(512);
          GetWindowText(h, sb, 512);
          var title = sb.ToString();
          if (String.IsNullOrEmpty(title)) return true;
          uint pid;
          GetWindowThreadProcessId(h, out pid);
          list.Add(new object[] { h.ToInt64(), (long)pid, title });
          return true;
        }, IntPtr.Zero);
      } finally {
        if (hDesk != IntPtr.Zero) {
          CloseDesktop(hDesk);
        }
      }
    });

    t.Start();
    t.Join(5000);

    foregroundHwnd = fg;
    windows = list;
  }
}
"@

$fg = 0
$rawWins = $null
[LcWin]::Query([ref]$fg, [ref]$rawWins)

$out = @()
foreach ($w in $rawWins) {
  $name = ''
  try { $name = (Get-Process -Id ([int]$w[1]) -ErrorAction Stop).ProcessName } catch {}
  $out += [pscustomobject]@{ hwnd = [long]$w[0]; pid = [long]$w[1]; process = $name; title = [string]$w[2] }
}
[pscustomobject]@{ foreground = $fg; windows = @($out) } | ConvertTo-Json -Depth 4 -Compress
