# Windows Task Scheduler Configuration for Daily Monitoring

## Setup Instructions

### Step 1: Create a new scheduled task
Open Task Scheduler (`taskschd.msc`) on Windows 11.

### Step 2: Add "Daily Status Check" Task

**General Tab:**
- Description: Daily Free Cash Finance status check with Rule #4 approval gate
- Task name: `Finance-Daily-Monitor-{YYYY}-{MM}-{DD}` or use dynamic naming pattern
- Configure for current user context (or System if API requires network permissions)

**Triggers Tab:**
- Begin the task: On a schedule
- Repeat task every: Not used (run once by default)
- Set a daily schedule from 05:30 to 09:30 UTC+02:00
    - Start task: 5:30 AM UTC+02:00 (03:30 or 04:30 UTC depending on DST rules).
- Task to start only if following conditions are met: 
        - Only when I'm logged on.

**Conditions Tab:**
- Start the task only on computer startup: ❌ (unchecked)
    - Stop the task if it runs longer than 3 hours. 

**Actions Tab:**
- Action: Start a program
- Program/script: cmd.exe /c powershell -ExecutionPolicy Bypass -Command "powershell -NoProfile -File D:\AgenticOS\finance-monitor\scripts\run_daily_check.ps1"

### Step 3: Configure Advanced Settings

Settings Tab:
- Allow task to be run on demand.
    - Run task as soon as possible.
- If the task fails, restart every: 5 minutes (up to 3 attempts).
        - Retry multiple times to complete if stopped/changed.
- Stop task if it runs longer than: 4 hours.
        - Stop task even if it's running outside of the scheduled time.

## PowerShell Script: run_daily_check.ps1

This script provides a PowerShell entry point for the Windows Task Scheduler. It validates prerequisites, sets up execution context, and runs the Python orchestrator via `python -m src.orchestrator`.

### Requirements
- Python 3.11+ installed on the system with the application in site-packages or added as a PATH source.
- The script runs under the user account that can execute external calls to APIs for status checks and notify managers.

```powershell
# Finance Daily Status Check - Entry Script
# Usage: .\\run_daily_check.ps1 [force]
# force - Optional parameter to override Rule #2 idempotency flag (testing/emergency only)

param(
    [switch]$force,
    $debug = $false
);

$ErrorActionPreference = "Stop"  # Fail on any error

# Prerequisites: ensure workspace location
$workspace = "D:\AgenticOS\finance-monitor"

# Set execution policy for this session (temporary change)
Set-ExecutionPolicy -Scope Process -Policy Bypass -PassThru

# Import configuration if available
$configPath = Join-Path $workspace "config\monitor.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath | ConvertFrom-JSON
} else {
    Write-Host -ForegroundColor Yellow "Configuration file not found, using defaults"
    $config = @{sandbox_mode=@{enabled=`true}}  # Defaults to sandbox if missing
}

# Build command string for Python module
$pythonCmd = "$env:SystemRoot\python.exe -m finance_monitor.src.orchestrator"
if($debug) {
    Write-Host -ForegroundColor Cyan "Debug mode enabled, skipping actual run"
} else {
    & $pythonCmd  @{config=$config}
}

# Capture exit code from Python process
$exit = $?
if ($? -eq `[false] && [int][Convert]::ToInt32($LASTEXITCODE) -ne 0) {
    Write-Host -ForegroundColor Red "Daily check failed or exited with non-zero status"
} else {
    Write-Host -ForegroundColor Green "Daily check completed successfully (or sandboxed)"
}

exit $LASTEXITCODE
```

---

## Alternative: Task Scheduler via PowerShell

If you prefer to create the task programmatically:

```powershell
# Create daily monitor task using PSCreateScheduledTask.ps1 helper

$taskDef = @{
        Action=@{Exec="cmd.exe"; Argument='/c powershell -NoProfile -File D:\AgenticOS\finance-monitor\scripts\run_daily_check.ps1'; Description='Finance Daily Monitor'}
        Trigger=@{Daily={Start=[datetime]::Now.AddDays(1).Date; Hours=5; Minutes=30}} # 05:30 UTC+02:00
}

Register-ScheduledTask -Name "Finance-Daily-Monitor" `
                        -Action $taskDef.Action `
                        -Trigger @{Daily=$false} `
                        -Settings @{RunOnlyIfOnBattery=$false; AllowStartIfOnBatteries=$true; StopIfTimeoutAfter='04:00:00'; StartOnlyIfLoggedOn=$true}

Write-Host "Task registered. Open Task Scheduler to customize further."
```

---

## Verification Checklist

- [ ] Task appears in `taskschd.msc` under Actions → Scheduled Tasks
- [ ] Trigger set to 05:30 UTC+02:00 daily (adjust for your timezone)
- [ ] Action points to script location or full Python module path
- [ ] Settings allow on-demand testing before scheduled execution
- [ ] Test manual trigger works via Task Scheduler → right-click → Run

---

## Audit Log Locations

After each run, check these logs:

1. `logs\monitor_{YYYY-MM-DD}.log` - Main orchestration log  
2. `sandbox.log` - Any action simulations (Rule #1 sandbox traces)  
3. Event Viewer → Windows Logs → Application - Task scheduler events  
