$source = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class DesktopCaptureHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);

    [DllImport("user32.dll")]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);

    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

    public static bool CaptureDesktop(string outPath) {
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}

        int width = GetSystemMetrics(78); // SM_CXVIRTUALSCREEN
        int height = GetSystemMetrics(79); // SM_CYVIRTUALSCREEN
        int left = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
        int top = GetSystemMetrics(77); // SM_YVIRTUALSCREEN

        if (width <= 0) width = GetSystemMetrics(0); // SM_CXSCREEN
        if (height <= 0) height = GetSystemMetrics(1); // SM_CYSCREEN

        IntPtr hdcSrc = GetDC(IntPtr.Zero);
        if (hdcSrc == IntPtr.Zero) return false;
        IntPtr hdcDest = CreateCompatibleDC(hdcSrc);
        IntPtr hBitmap = CreateCompatibleBitmap(hdcSrc, width, height);
        IntPtr hOld = SelectObject(hdcDest, hBitmap);

        bool success = BitBlt(hdcDest, 0, 0, width, height, hdcSrc, left, top, 0x00CC0020); // SRCCOPY

        SelectObject(hdcDest, hOld);
        DeleteDC(hdcDest);
        ReleaseDC(IntPtr.Zero, hdcSrc);

        if (success) {
            using (Bitmap bmp = Bitmap.FromHbitmap(hBitmap)) {
                bmp.Save(outPath, ImageFormat.Png);
            }
        }
        DeleteObject(hBitmap);
        return success;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
$res = [DesktopCaptureHelper]::CaptureDesktop("test_desktop_full.png")
Write-Output "CaptureDesktop: $res"
if (Test-Path test_desktop_full.png) {
    Get-Item test_desktop_full.png | Select-Object FullName, Length
}
