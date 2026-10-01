param(
    [string]$Action,
    [string]$Target,
    [string]$ProcessNames
)

$ErrorActionPreference = "SilentlyContinue"

if ($Action -eq "check_process") {
    $pList = $ProcessNames -split ','
    $found = $null
    foreach ($pName in $pList) {
        $p = Get-Process -Name $pName.Trim() -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p -and $p.Id) {
            $found = [PSCustomObject]@{
                Id = $p.Id
                Name = $p.ProcessName
                Title = $p.MainWindowTitle
                Hwnd = $p.MainWindowHandle.ToInt64()
            }
            break
        }
    }
    if ($found) {
        $found | ConvertTo-Json -Compress
    } else {
        "{}"
    }
    exit 0
}

if ($Action -eq "check_word") {
    try {
        $w = $null
        try {
            $w = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
        } catch {
            $w = New-Object -ComObject Word.Application
            $w.Visible = $true
        }
        if ($w.Documents.Count -eq 0) {
            $null = $w.Documents.Add()
        }
        $docName = $null
        try { $docName = $w.ActiveDocument.Name } catch {}
        if (-not $docName -and $w.Documents.Count -gt 0) {
            try { $docName = $w.Documents.Item(1).Name } catch {}
        }
        if (-not $docName) {
            $docName = $w.ActiveWindow.Caption
        }
        [PSCustomObject]@{
            ActiveDoc = $docName
            DocCount = $w.Documents.Count
            Caption = $w.ActiveWindow.Caption
            Visible = $w.Visible
        } | ConvertTo-Json -Compress
    } catch {
        "{}"
    }
    exit 0
}

if ($Action -eq "check_browser") {
    $browsers = Get-Process | Where-Object { 
        $_.ProcessName -match 'chrome|msedge|firefox|brave|comet' 
    } | Where-Object { $_.MainWindowHandle -ne 0 -or $_.MainWindowTitle } | Select-Object -First 1
    if (-not $browsers) {
        $browsers = Get-Process -Name 'chrome','msedge','comet' -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($browsers) {
        [PSCustomObject]@{
            Id = $browsers.Id
            Name = $browsers.ProcessName
            Title = $browsers.MainWindowTitle
            Hwnd = $browsers.MainWindowHandle.ToInt64()
        } | ConvertTo-Json -Compress
    } else {
        "{}"
    }
    exit 0
}
