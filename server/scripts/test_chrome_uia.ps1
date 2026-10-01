$source = @"
using System;
using System.Runtime.InteropServices;

public class WinStationAttacher {
    [DllImport("user32.dll")]
    public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);
    [DllImport("user32.dll")]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

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

$hwnd = [IntPtr]462472
$element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($element) {
    Write-Output "Got AutomationElement: $($element.Current.Name)"
    $children = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output "Found $($children.Count) descendant elements in Chrome_RenderWidgetHostHWND!"
    foreach ($c in $children) {
        $n = $c.Current.Name
        $ct = $c.Current.ControlType.ProgrammaticName
        if ($n) {
            Write-Output " - $($ct): $($n)"
        }
    }
}
