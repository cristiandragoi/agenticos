import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function inspectWindowDirect(target) {
  let windowHandle = null;
  let processId = null;
  let kw = 'Chrome';

  if (typeof target === 'object' && target !== null) {
    windowHandle = target.windowHandle ?? null;
    processId = target.processId ?? null;
    kw = target.titleKeyword || kw;
  } else if (typeof target === 'number') {
    windowHandle = target;
  }

  const psScript = `
$csharp = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinStationTest {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
}
'@
if (-not ([System.Management.Automation.PSTypeName]'WinStationTest').Type) {
    Add-Type -TypeDefinition $csharp
}

$winsta = [WinStationTest]::OpenWindowStation("WinSta0", $false, 0x10000000)
if ($winsta -ne [IntPtr]::Zero) { [WinStationTest]::SetProcessWindowStation($winsta) | Out-Null }
$desk = [WinStationTest]::OpenDesktop("Default", 0, $false, 0x10000000)
if ($desk -ne [IntPtr]::Zero) { [WinStationTest]::SetThreadDesktop($desk) | Out-Null }

$targetHwnd = [IntPtr]${windowHandle || 0}
$targetPid = ${processId || 0}
$kw = "${kw}"
$fgHwnd = [WinStationTest]::GetForegroundWindow()
$global:found = $null

if ($targetHwnd -ne [IntPtr]::Zero) {
    if ([WinStationTest]::IsWindow($targetHwnd)) {
        $sb = New-Object System.Text.StringBuilder 512
        [WinStationTest]::GetWindowText($targetHwnd, $sb, 512) | Out-Null
        $wPid = 0
        [WinStationTest]::GetWindowThreadProcessId($targetHwnd, [ref]$wPid) | Out-Null
        $isVis = [WinStationTest]::IsWindowVisible($targetHwnd)
        $isMin = [WinStationTest]::IsIconic($targetHwnd)
        $isFg = ($targetHwnd -eq $fgHwnd)
        $global:found = [PSCustomObject]@{
            Handle = $targetHwnd.ToInt64()
            Pid = $wPid
            Title = $sb.ToString()
            IsVisible = $isVis
            IsMinimized = $isMin
            IsForeground = $isFg
        }
    }
}

if (-not $global:found) {
    [WinStationTest]::EnumDesktopWindows($desk, {
        param($hWnd, $lParam)
        $sb = New-Object System.Text.StringBuilder 512
        [WinStationTest]::GetWindowText($hWnd, $sb, 512) | Out-Null
        $t = $sb.ToString()
        if ($t.Length -gt 0 -and [WinStationTest]::IsWindowVisible($hWnd)) {
            $wPid = 0
            [WinStationTest]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
            $clsSb = New-Object System.Text.StringBuilder 256
            [WinStationTest]::GetClassName($hWnd, $clsSb, 256) | Out-Null
            $cls = $clsSb.ToString()
            
            $p = Get-Process -Id $wPid -ErrorAction SilentlyContinue
            $pName = if ($p) { $p.ProcessName.ToLower() } else { "" }

            $matches = $false
            if ($targetPid -ne 0 -and $wPid -eq $targetPid) {
                $matches = $true
            } elseif ($targetPid -eq 0) {
                if ($pName -match "chrome|msedge|antigravity" -and $cls -eq "Chrome_WidgetWin_1" -and $t -ne "Automatische Untertitel") {
                    $matches = $true
                } elseif ($t -match "Chrome|Edge|YouTube|Google|BitChute") {
                    $matches = $true
                }
            }

            if ($matches) {
                $isMin = [WinStationTest]::IsIconic($hWnd)
                $isFg = ($hWnd -eq $fgHwnd)
                $global:found = [PSCustomObject]@{
                    Handle = $hWnd.ToInt64()
                    Pid = $wPid
                    Title = $t
                    IsVisible = $true
                    IsMinimized = $isMin
                    IsForeground = $isFg
                }
                return $false
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
}

if ($global:found) {
    $global:found | ConvertTo-Json -Compress
} else {
    "{}"
}
`;

  const tmp = path.join(process.env.TEMP || 'C:\\Temp', `inspect_test_${Date.now()}.ps1`);
  fs.writeFileSync(tmp, psScript, 'utf8');
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' }).trim();
    return JSON.parse(raw || '{}');
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function run() {
  console.log('1. Testing inspectWindow with Antigravity IDE window...');
  // Inspect generic
  const generic = inspectWindowDirect(null);
  console.log('Generic search result:', generic);

  if (generic.Handle) {
    console.log('2. Testing inspectWindow with explicit HWND:', generic.Handle);
    const byHwnd = inspectWindowDirect(generic.Handle);
    console.log('Explicit HWND result:', byHwnd);
  }
}

run().catch(console.error);
