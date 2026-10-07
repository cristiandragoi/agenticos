Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]2493010)
$listCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::List)
$lists = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCond)
foreach ($l in $lists) {
    if ($l.Current.Name -eq 'Messages') {
        $itemCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
        $items = $l.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
        Write-Host "Found Messages list with items count: $($items.Count)"
        for ($i = [Math]::Max(0, $items.Count - 8); $i -lt $items.Count; $i++) {
            $it = $items[$i]
            $rect = $it.Current.BoundingRectangle
            Write-Host "--- ITEM $i [AutomationId: $($it.Current.AutomationId), Bounds: $($rect.Top),$($rect.Left)] ---"
            Write-Host "Name: $($it.Current.Name.Replace("`n", ' | '))"
            
            # Find DataItem children (Sender, Message, Time)
            $dataCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::DataItem)
            $dataItems = $it.FindAll([System.Windows.Automation.TreeScope]::Children, $dataCond)
            foreach ($d in $dataItems) {
                Write-Host "   Child DataItem: Name='$($d.Current.Name)' Value='$($d.Current.Value)'"
            }
        }
    }
}
