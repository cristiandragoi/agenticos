# Graceful WM_CLOSE for Agentic OS — no force-kill.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WmClose2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static int SendToPid(uint pid) {
    int sent = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == pid) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); sent++; }
      return true;
    }, IntPtr.Zero);
    return sent;
  }
}
"@

$procs = Get-Process | Where-Object { $_.ProcessName -match 'Agentic' }
$total = 0
foreach ($p in $procs) {
  try { $total += [WmClose2]::SendToPid([uint32]$p.Id) } catch { }
}
Write-Output "WM_CLOSE_SENT=$total"
# Wait up to 20s for natural exit.
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 2
  $left = (Get-Process | Where-Object { $_.ProcessName -match 'Agentic' } | Measure-Object).Count
  Write-Output "REMAINING=$left"
  if ($left -eq 0) { break }
}
