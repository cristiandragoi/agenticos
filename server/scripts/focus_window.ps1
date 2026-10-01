param(
  [Parameter(Mandatory=$false)]
  [string]$ProcessName = "",
  [Parameter(Mandatory=$false)]
  [string]$Title = "",
  [Parameter(Mandatory=$false)]
  [string]$LauncherPath = ""
)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public class WinFocusScriptHelper {
    [DllImport("user32.dll")] public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public static string Focus(string procName, string titleKw) {
        IntPtr targetHwnd = IntPtr.Zero;
        string targetTitle = "";
        uint targetPid = 0;
        IntPtr fgBefore = IntPtr.Zero;
        IntPtr fgAfter = IntPtr.Zero;
        string fgTitle = "";
        bool verified = false;

        string pLower = (procName ?? "").ToLower().Replace(".exe", "").Trim();
        string tLower = (titleKw ?? "").ToLower().Trim();

        Thread t = new Thread(() => {
            IntPtr hDesk = IntPtr.Zero;
            try {
                IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
                if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
                hDesk = OpenDesktop("Default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
            } catch {}

            EnumProc proc = (hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                string title = sb.ToString();
                if (string.IsNullOrEmpty(title)) return true;

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string pName = "";
                try {
                    pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower();
                } catch {}

                bool match = false;
                if (!string.IsNullOrEmpty(pLower) && pName.Contains(pLower)) {
                    match = true;
                } else if (!string.IsNullOrEmpty(tLower) && title.ToLower().Contains(tLower)) {
                    match = true;
                }

                if (match) {
                    targetHwnd = hWnd;
                    targetTitle = title;
                    targetPid = pid;
                    return false;
                }
                return true;
            };

            if (hDesk != IntPtr.Zero) {
                EnumDesktopWindows(hDesk, proc, IntPtr.Zero);
            }
            if (targetHwnd == IntPtr.Zero) {
                EnumWindows(proc, IntPtr.Zero);
            }

            if (targetHwnd != IntPtr.Zero) {
                fgBefore = GetForegroundWindow();
                uint curFgPid = 0;
                uint fgThread = GetWindowThreadProcessId(fgBefore, out curFgPid);
                uint myThread = GetCurrentThreadId();
                uint targetThread = GetWindowThreadProcessId(targetHwnd, out targetPid);

                if (fgThread != 0 && fgThread != myThread) {
                    AttachThreadInput(myThread, fgThread, true);
                }
                if (targetThread != 0 && targetThread != myThread) {
                    AttachThreadInput(myThread, targetThread, true);
                }

                keybd_event(0x12, 0, 0, 0); // Alt down
                ShowWindow(targetHwnd, SW_RESTORE);
                BringWindowToTop(targetHwnd);
                SetForegroundWindow(targetHwnd);
                SwitchToThisWindow(targetHwnd, true);
                keybd_event(0x12, 0, 2, 0); // Alt up

                if (fgThread != 0 && fgThread != myThread) {
                    AttachThreadInput(myThread, fgThread, false);
                }
                if (targetThread != 0 && targetThread != myThread) {
                    AttachThreadInput(myThread, targetThread, false);
                }

                Thread.Sleep(200);

                fgAfter = GetForegroundWindow();
                StringBuilder fgSb = new StringBuilder(512);
                GetWindowText(fgAfter, fgSb, 512);
                fgTitle = fgSb.ToString();

                verified = (fgAfter == targetHwnd) || (IsWindowVisible(targetHwnd) && !IsIconic(targetHwnd));
            }

            if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();

        if (targetHwnd == IntPtr.Zero) {
            return "{\"found\":false}";
        }

        string b64Fg = Convert.ToBase64String(Encoding.UTF8.GetBytes(fgTitle));
        return "{\"found\":true,\"verified\":" + (verified ? "true" : "false") + ",\"hwnd\":" + targetHwnd.ToInt64() + ",\"fgHwnd\":" + fgAfter.ToInt64() + ",\"fgTitleB64\":\"" + b64Fg + "\"}";
    }
}
"@

$res = [WinFocusScriptHelper]::Focus($ProcessName, $Title)
$parsed = $res | ConvertFrom-Json

if (-not $parsed.found -and $LauncherPath -and (Test-Path $LauncherPath)) {
    Start-Process -FilePath $LauncherPath -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    $res = [WinFocusScriptHelper]::Focus($ProcessName, $Title)
    $parsed = $res | ConvertFrom-Json
}

Write-Output $res
