$source = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinLister {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public static string GetWindowsJson() {
        IntPtr hDesk = IntPtr.Zero;
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}

        List<string> entries = new List<string>();
        EnumProc proc = (hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString();
            if (string.IsNullOrEmpty(title)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            string pName = "";
            try { pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
            entries.Add(string.Format("{{\"hwnd\":{0},\"pid\":{1},\"process\":\"{2}\",\"title\":{3}}}",
                hWnd.ToInt64(), pid, pName, System.Web.HttpUtility.JavaScriptStringEncode(title, true)));
            return true;
        };

        if (hDesk != IntPtr.Zero) {
            EnumDesktopWindows(hDesk, proc, IntPtr.Zero);
        }
        if (entries.Count == 0) {
            EnumWindows(proc, IntPtr.Zero);
        }

        return "[" + string.Join(",", entries.ToArray()) + "]";
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Web
[WinLister]::GetWindowsJson()
