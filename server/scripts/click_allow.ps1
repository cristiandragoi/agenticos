$source = @"
using System;
using System.Runtime.InteropServices;
public class WinStationAttacher {
    [DllImport("user32.dll")] public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    public static void Attach() {
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        } catch {}
    }
}
"@
Add-Type -TypeDefinition $source
[WinStationAttacher]::Attach()
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$hwnd = [IntPtr]8586852
[WinStationAttacher]::SetForegroundWindow($hwnd)
$element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($element) {
    Write-Output "Element: $($element.Current.Name)"
    $children = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($c in $children) {
        Write-Output " - $($c.Current.ControlType.ProgrammaticName): $($c.Current.Name)"
        if ($c.Current.Name -match "Zulassen|Allow") {
            Write-Output "Found Allow button! Invoking..."
            $invokePattern = $c.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Output "INVOKED!"
            }
        }
    }
}
