# Executor helper: bring ONE specific window to the foreground and type text into it.
# Refuses to type unless that exact window is the foreground window. Receipt only.
param([Parameter(Mandatory=$true)][long]$Hwnd, [Parameter(Mandatory=$true)][string]$TextB64)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class LcFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint me = GetCurrentThreadId();
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (fgThread != me) AttachThreadInput(me, fgThread, true);
    SetForegroundWindow(h);
    if (fgThread != me) AttachThreadInput(me, fgThread, false);
    return GetForegroundWindow() == h;
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
  if ([LcFg]::GetForegroundWindow() -ne $h) { throw "foreground changed before typing; refusing to type" }
  $escaped = [regex]::Replace($text, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  $r.sent = $true
} catch { $r.error = $_.Exception.Message }
[pscustomobject]$r | ConvertTo-Json -Compress
