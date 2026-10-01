Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

Write-Output "Found $($children.Count) top-level elements:"
foreach ($c in $children) {
    $name = $c.Current.Name
    $pid = $c.Current.ProcessId
    $class = $c.Current.ClassName
    Write-Output "[$pid] '$name' ($class)"
}
