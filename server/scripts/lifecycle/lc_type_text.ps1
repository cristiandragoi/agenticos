# Executor helper: bring ONE specific window to the foreground and type text into it.
# Refuses to type unless that exact window is the foreground window. Receipt only.
param([Parameter(Mandatory=$true)][long]$Hwnd, [Parameter(Mandatory=$true)][string]$TextB64)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Threading;
using System.Runtime.InteropServices;
public class LcFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr hDesktop);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr hDesktop);

  public static bool Focus(IntPtr h) {
    bool ok = false;
    Thread t = new Thread(() => {
      IntPtr hDesk = OpenDesktop("default", 0, false, 0x01FF);
      if (hDesk != IntPtr.Zero) {
        SetThreadDesktop(hDesk);
      }
      try {
        if (IsIconic(h)) ShowWindow(h, 9);
        ShowWindow(h, 5);
        IntPtr fg = GetForegroundWindow();
        uint fgPid = 0;
        uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
        uint hPid = 0;
        GetWindowThreadProcessId(h, out hPid);
        uint me = GetCurrentThreadId();
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        if (fgThread != me) AttachThreadInput(me, fgThread, true);
        SetForegroundWindow(h);
        if (fgThread != me) AttachThreadInput(me, fgThread, false);
        IntPtr newFg = GetForegroundWindow();
        uint newFgPid = 0;
        GetWindowThreadProcessId(newFg, out newFgPid);
        ok = (newFg == h) || (hPid != 0 && newFgPid == hPid);
      } finally {
        if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
      }
    });
    t.Start();
    t.Join(5000);
    return ok;
  }
}
"@
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextB64))
$r = [ordered]@{ hwnd = $Hwnd; foregroundConfirmed = $false; sent = $false; chars = $text.Length }
try {
  $h = [IntPtr]$Hwnd
  $ok = $false
  for ($i = 0; $i -lt 5 -and -not $ok; $i++) { $ok = [LcFg]::Focus($h); if (-not $ok) { Start-Sleep -Milliseconds 250 } }
  $r.foregroundConfirmed = $ok
  if (-not $ok) { throw "target window $Hwnd is not the foreground window; refusing to type" }
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($h)
    $cond = New-Object System.Windows.Automation.OrCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    $doc = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($doc) { $doc.SetFocus(); $r.focusedControl = $doc.Current.ControlType.ProgrammaticName }
  } catch { $r.focusWarning = $_.Exception.Message }
  $fgNow = [LcFg]::GetForegroundWindow()
  $pidFg = 0
  [LcFg]::GetWindowThreadProcessId($fgNow, [ref]$pidFg)
  $pidH = 0
  [LcFg]::GetWindowThreadProcessId($h, [ref]$pidH)
  if ($fgNow -ne $h -and ($pidFg -eq 0 -or $pidFg -ne $pidH)) { throw "foreground changed before typing; refusing to type" }
  $escaped = [regex]::Replace($text, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  $r.sent = $true
} catch { $r.error = $_.Exception.Message }
[pscustomobject]$r | ConvertTo-Json -Compress
