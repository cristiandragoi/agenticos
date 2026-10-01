import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ps1 = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInspector {
    public delegate bool EnumThreadDelegate(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumThreadWindows(int dwThreadId, EnumThreadDelegate lpfn, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$pids = Get-Process -Name 'chrome' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*ms-playwright*' }
foreach ($p in $pids) {
    Write-Output "PID: $($p.Id) Threads: $($p.Threads.Count)"
    foreach ($t in $p.Threads) {
        [WinInspector]::EnumThreadWindows($t.Id, {
            param($hWnd, $lParam)
            $sbText = New-Object System.Text.StringBuilder 512
            [WinInspector]::GetWindowText($hWnd, $sbText, 512) | Out-Null
            $sbClass = New-Object System.Text.StringBuilder 512
            [WinInspector]::GetClassName($hWnd, $sbClass, 512) | Out-Null
            $vis = [WinInspector]::IsWindowVisible($hWnd)
            $rect = New-Object WinInspector+RECT
            [WinInspector]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
            Write-Output "   HWND: $hWnd Vis: $vis Class: $($sbClass.ToString()) Text: '$($sbText.ToString())' Rect: ($($rect.Left),$($rect.Top))-($($rect.Right),$($rect.Bottom))"
            return $true
        }, [IntPtr]::Zero) | Out-Null
    }
}
`;

const file = path.join(process.cwd(), 'scripts', '_test_inspect_hwnds.ps1');
fs.writeFileSync(file, ps1);
try {
  const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"`, { encoding: 'utf-8' });
  console.log(out);
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
