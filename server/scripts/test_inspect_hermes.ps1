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

$hwnd = [IntPtr]4198064
try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($element) {
        Write-Output "Successfully got AutomationElement for HWND 4198064!"
        Write-Output "Name: $($element.Current.Name)"
        Write-Output "ClassName: $($element.Current.ClassName)"
        Write-Output "ControlType: $($element.Current.ControlType.ProgrammaticName)"
        
        $allChildren = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output "Total descendant elements: $($allChildren.Count)"
        
        $texts = @()
        foreach ($child in $allChildren) {
            $name = $child.Current.Name
            $ct = $child.Current.ControlType.ProgrammaticName
            $val = ""
            try {
                $valPattern = $child.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($valPattern) { $val = $valPattern.Current.Value }
            } catch {}
            
            if ($name -or $val) {
                $texts += [PSCustomObject]@{
                    Type = $ct
                    Name = $name
                    Value = $val
                }
            }
        }
        
        Write-Output "Visible controls & texts extracted ($($texts.Count)):"
        $texts | Select-Object -First 30 | Format-Table -AutoSize
    }
} catch {
    Write-Output "Error: $_"
}
