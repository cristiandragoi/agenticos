# Read-only probe: visible top-level windows + current foreground window.
# Output: JSON { foreground: <hwnd>, windows: [ { hwnd, pid, process, title } ] }
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class LcWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<object[]> List() {
    var r = new List<object[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      var t = sb.ToString(); if (String.IsNullOrEmpty(t)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      r.Add(new object[] { h.ToInt64(), (long)pid, t }); return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
$out = @()
foreach ($w in [LcWin]::List()) {
  $name = ''
  try { $name = (Get-Process -Id ([int]$w[1]) -ErrorAction Stop).ProcessName } catch {}
  $out += [pscustomobject]@{ hwnd = [long]$w[0]; pid = [long]$w[1]; process = $name; title = [string]$w[2] }
}
[pscustomobject]@{ foreground = [long][LcWin]::GetForegroundWindow().ToInt64(); windows = @($out) } | ConvertTo-Json -Depth 4 -Compress
