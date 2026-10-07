param(
  [Parameter(Mandatory=$true)]
  [long]$Hwnd
)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public class WinProbeScriptHelper {
    [DllImport("user32.dll")] public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const uint GW_OWNER = 4;
    public const int WS_EX_TOOLWINDOW = 0x00000080;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static string Probe(long rawHwnd) {
        bool isValid = false;
        bool visible = false;
        bool iconic = false;
        bool isForeground = false;
        bool isToolWindow = false;
        bool hasOwner = false;
        uint pid = 0;
        string pname = "";
        string title = "";
        int left = 0, top = 0, right = 0, bottom = 0;
        long finalHwnd = 0;

        Thread t = new Thread(() => {
            IntPtr hDesk = IntPtr.Zero;
            try {
                IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
                if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
                hDesk = OpenDesktop("Default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
            } catch {}

            IntPtr hWnd = (IntPtr)rawHwnd;
            if (rawHwnd <= 0) {
                hWnd = GetForegroundWindow();
            }
            finalHwnd = (long)hWnd;
            isValid = (hWnd != IntPtr.Zero) && IsWindow(hWnd);
            if (isValid) {
                visible = IsWindowVisible(hWnd);
                iconic = IsIconic(hWnd);
                IntPtr fg = GetForegroundWindow();
                isForeground = (fg == hWnd);

                GetWindowThreadProcessId(hWnd, out pid);
                try {
                    pname = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
                } catch {}

                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                title = sb.ToString();

                RECT r;
                if (GetWindowRect(hWnd, out r)) {
                    left = r.Left;
                    top = r.Top;
                    right = r.Right;
                    bottom = r.Bottom;
                }

                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                isToolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;
                IntPtr owner = GetWindow(hWnd, GW_OWNER);
                hasOwner = (owner != IntPtr.Zero);
            }

            if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();

        if (!isValid) {
            return "{\"isValid\":false}";
        }

        string b64Title = Convert.ToBase64String(Encoding.UTF8.GetBytes(title));
        return "{\"isValid\":true,\"hwnd\":" + finalHwnd +
               ",\"visible\":" + (visible ? "true" : "false") +
               ",\"iconic\":" + (iconic ? "true" : "false") +
               ",\"isForeground\":" + (isForeground ? "true" : "false") +
               ",\"isToolWindow\":" + (isToolWindow ? "true" : "false") +
               ",\"hasOwner\":" + (hasOwner ? "true" : "false") +
               ",\"pid\":" + pid +
               ",\"process\":\"" + pname + "\"" +
               ",\"titleB64\":\"" + b64Title + "\"" +
               ",\"left\":" + left + ",\"top\":" + top + ",\"right\":" + right + ",\"bottom\":" + bottom + "}";
    }
}
"@

$res = [WinProbeScriptHelper]::Probe($Hwnd)
Write-Output $res
