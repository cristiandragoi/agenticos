$source = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class ChildEnumHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    public static List<string> GetChildren(IntPtr parent) {
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}

        List<string> list = new List<string>();
        EnumChildWindows(parent, (hWnd, lParam) => {
            StringBuilder cls = new StringBuilder(256);
            GetClassName(hWnd, cls, 256);
            StringBuilder txt = new StringBuilder(256);
            GetWindowText(hWnd, txt, 256);
            list.Add(hWnd.ToInt64() + " | " + cls.ToString() + " | " + txt.ToString());
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@
Add-Type -TypeDefinition $source
$children = [ChildEnumHelper]::GetChildren([IntPtr]4198064)
Write-Output "Found $($children.Count) child windows:"
$children | ForEach-Object { Write-Output $_ }
