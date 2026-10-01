Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinLister {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  public static List<string> GetTitles() {
    List<string> res = new List<string>();
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        int length = GetWindowTextLength(hWnd);
        if (length > 0) {
          StringBuilder sb = new StringBuilder(length + 1);
          GetWindowText(hWnd, sb, sb.Capacity);
          uint pid;
          GetWindowThreadProcessId(hWnd, out pid);
          res.Add(pid + " | " + sb.ToString());
        }
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@

$list = [WinLister]::GetTitles()
foreach ($item in $list) {
  Write-Output $item
}
