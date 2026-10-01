$source = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ScreenGrabber {
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

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

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static bool CaptureWindow(IntPtr hWnd, string filePath) {
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) return false;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return false;

        IntPtr hdcSrc = GetWindowDC(hWnd);
        IntPtr hdcDest = CreateCompatibleDC(hdcSrc);
        IntPtr hBitmap = CreateCompatibleBitmap(hdcSrc, width, height);
        IntPtr hOld = SelectObject(hdcDest, hBitmap);

        // Try PrintWindow first (works even if partially obscured)
        bool success = PrintWindow(hWnd, hdcDest, 2); // PW_RENDERFULLCONTENT = 2
        if (!success) {
            success = BitBlt(hdcDest, 0, 0, width, height, hdcSrc, 0, 0, 0x00CC0020); // SRCCOPY
        }

        SelectObject(hdcDest, hOld);
        DeleteDC(hdcDest);
        ReleaseDC(hWnd, hdcSrc);

        if (success) {
            using (Bitmap bmp = Bitmap.FromHbitmap(hBitmap)) {
                bmp.Save(filePath, ImageFormat.Png);
            }
        }
        DeleteObject(hBitmap);
        return success;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
$hwnd = [ScreenGrabber]::GetForegroundWindow()
Write-Output "Foreground HWND: $hwnd"
$res = [ScreenGrabber]::CaptureWindow($hwnd, "test_hwnd_cap.png")
Write-Output "Capture success: $res"
if (Test-Path test_hwnd_cap.png) {
    Get-Item test_hwnd_cap.png | Select-Object FullName, Length
}
