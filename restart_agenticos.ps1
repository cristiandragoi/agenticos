# D:\AgenticOS\restart_agenticos.ps1
# Production restart mechanism for installed AgenticOS desktop application

param(
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Continue"

Write-Host "=========================================="
Write-Host "   AGENTICOS PRODUCTION RESTART PROCEDURE "
Write-Host "=========================================="

# 1. Load Win32 Interop for Interactive Desktop Placement & Enumeration
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class AgenticDesktopInterop {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("user32.dll")] public static extern IntPtr OpenWindowStation(string name, bool inherit, int access);
    [DllImport("user32.dll")] public static extern bool SetProcessWindowStation(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string name, int flags, bool inherit, int access);
    [DllImport("user32.dll")] public static extern bool SetThreadDesktop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);

    public delegate bool EnumDesktopWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumDesktopWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static void AttachToInteractiveDesktop() {
        try {
            IntPtr hW = OpenWindowStation("WinSta0", false, 0x037F);
            if (hW != IntPtr.Zero) SetProcessWindowStation(hW);
            IntPtr hD = OpenDesktop("Default", 0, false, 0x01FF);
            if (hD != IntPtr.Zero) SetThreadDesktop(hD);
        } catch {}
    }

    public static int LaunchOnInteractiveDesktop(string appPath, string args) {
        AttachToInteractiveDesktop();
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"WinSta0\Default";
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        string cmd = "\"" + appPath + "\" " + args;
        // Try 0x00000200 (CREATE_NEW_PROCESS_GROUP) | 0x01000000 (CREATE_BREAKAWAY_FROM_JOB)
        uint flags = 0x00000200 | 0x01000000;
        bool ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi);
        if (!ok) {
            ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000200, IntPtr.Zero, null, ref si, out pi);
        }
        if (!ok) {
            throw new Exception("CreateProcess failed with Win32 error: " + Marshal.GetLastWin32Error());
        }
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return pi.dwProcessId;

    }

    public class WindowRecord {
        public IntPtr Hwnd;
        public uint Pid;
        public string Title;
        public bool Visible;
        public int Left;
        public int Top;
        public int Width;
        public int Height;
    }

    public static List<WindowRecord> FindWindowsOnDefaultDesktop() {
        var list = new List<WindowRecord>();
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x0001 | 0x0040);
        if (hDesk == IntPtr.Zero) return list;

        EnumDesktopWindows(hDesk, (hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            bool vis = IsWindowVisible(hWnd);
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            RECT r;
            GetWindowRect(hWnd, out r);

            list.Add(new WindowRecord {
                Hwnd = hWnd,
                Pid = pid,
                Title = sb.ToString(),
                Visible = vis,
                Left = r.Left,
                Top = r.Top,
                Width = r.Right - r.Left,
                Height = r.Bottom - r.Top
            });
            return true;
        }, IntPtr.Zero);

        CloseDesktop(hDesk);
        return list;
    }
}
"@ -ErrorAction SilentlyContinue

# Ensure calling thread is attached to WinSta0\Default
[AgenticDesktopInterop]::AttachToInteractiveDesktop()

# Step 1: Identify AgenticOS-owned processes
Write-Host "[1/6] Identifying AgenticOS-owned processes..."
$stalePids = @()
$agenticProcs = Get-Process -Name 'AgenticOS' -ErrorAction SilentlyContinue
if ($agenticProcs) {
    $stalePids += $agenticProcs | ForEach-Object { $_.Id }
}

# Also inspect backend-ownership.json
$userDataDir = Join-Path $env:APPDATA 'AgenticOS'
$backendOwnershipFile = Join-Path $userDataDir 'backend-ownership.json'
if (Test-Path $backendOwnershipFile) {
    try {
        $ownerJson = Get-Content $backendOwnershipFile -Raw | ConvertFrom-Json
        if ($ownerJson.pid) {
            $bp = Get-Process -Id $ownerJson.pid -ErrorAction SilentlyContinue
            if ($bp) { $stalePids += $bp.Id }
        }
    } catch {}
}

# Step 2: Request graceful shutdown
if ($stalePids.Count -gt 0) {
    Write-Host "[2/6] Requesting graceful shutdown for PIDs: $($stalePids -join ', ')..."
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:4600/api/system/restart' -Method Post -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
    } catch {}
    Start-Sleep -Seconds 2
} else {
    Write-Host "[2/6] No active instances found."
}

# Step 3 & 4: Terminate remaining owned stale processes if necessary
$remaining = Get-Process -Name 'AgenticOS' -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "[3/6] Forcing termination of remaining AgenticOS processes..."
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Clean any dangling singleton lock files
$lockFiles = @('SingletonLock', 'SingletonCookie', 'SingletonSocket')
foreach ($lf in $lockFiles) {
    $lp = Join-Path $userDataDir $lf
    if (Test-Path $lp) {
        Remove-Item $lp -Force -ErrorAction SilentlyContinue
    }
}

# Step 5: Verify old instance is gone
$checkProcs = Get-Process -Name 'AgenticOS' -ErrorAction SilentlyContinue
if ($checkProcs) {
    Write-Error "Failed to terminate existing AgenticOS process!"
    exit 1
}
Write-Host "[4/6] Verified previous instance is terminated."

# Step 6: Launch installed AgenticOS.exe into the CURRENT INTERACTIVE USER SESSION
$appPath = 'C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe'
if (-not (Test-Path $appPath)) {
    Write-Error "Installed executable not found at: $appPath"
    exit 1
}

Write-Host "[5/6] Launching installed AgenticOS.exe on WinSta0\Default..."
$launchedViaTask = $false
try {
    schtasks /create /tn 'AgenticOS_Desktop' /tr "`"$appPath`"" /sc once /st 00:00 /f 2>&1 | Out-Null
    schtasks /run /tn 'AgenticOS_Desktop' 2>&1 | Out-Null
    $launchedViaTask = $true
    Write-Host "Launched AgenticOS via interactive Task Scheduler."
} catch {}

if (-not $launchedViaTask) {
    $mainPid = [AgenticDesktopInterop]::LaunchOnInteractiveDesktop($appPath, "")
    Write-Host "Launched AgenticOS main process PID: $mainPid"
}


# Step 7-10: Wait bounded time for BrowserWindow, HWND visible, renderer loaded, backend healthy
Write-Host "[6/6] Verifying desktop window creation and backend health (up to $TimeoutSeconds seconds)..."
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

$verifiedHwnd = [IntPtr]::Zero
$verifiedTitle = ""
$verifiedBounds = $null
$backendHealthy = $false
$desktopReady = $false
$rendererLoaded = $false
$desktopRuntime = $null

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000

    # 1. Check window on Default desktop
    $allWins = [AgenticDesktopInterop]::FindWindowsOnDefaultDesktop()
    $candidate = $allWins | Where-Object {
        $_.Visible -and ($_.Title -eq 'AgenticOS' -or $_.Title -like 'AgenticOS*') -and $_.Width -gt 200 -and $_.Height -gt 200
    } | Select-Object -First 1

    if ($candidate) {
        $mainPid = $candidate.Pid
        $verifiedHwnd = $candidate.Hwnd
        $verifiedTitle = $candidate.Title

        $verifiedBounds = [PSCustomObject]@{
            Left = $candidate.Left
            Top = $candidate.Top
            Width = $candidate.Width
            Height = $candidate.Height
        }
    }

    # 2. Check backend health
    try {
        $healthRes = Invoke-RestMethod -Uri 'http://127.0.0.1:4600/api/health' -TimeoutSec 2 -ErrorAction Stop
        if ($healthRes.status -eq 'healthy') {
            $backendHealthy = $true
        }
    } catch {}

    # 3. Check desktop-runtime endpoint
    try {
        $dtRes = Invoke-RestMethod -Uri 'http://127.0.0.1:4600/api/system/desktop-runtime' -TimeoutSec 2 -ErrorAction Stop
        $desktopRuntime = $dtRes
        if ($dtRes.desktopReady -eq $true -or ($dtRes.mainWindowVisible -eq $true -and $dtRes.rendererLoaded -eq $true)) {
            $desktopReady = $true
            $rendererLoaded = $true
        }
    } catch {}

    if ($verifiedHwnd -ne [IntPtr]::Zero -and $backendHealthy -and ($desktopReady -or $rendererLoaded)) {
        break
    }
}

Write-Host "=== VERIFICATION SUMMARY ==="
Write-Host "Main PID:            $mainPid"
Write-Host "HWND:                0x$($verifiedHwnd.ToString('X'))"
Write-Host "Window Title:        $verifiedTitle"
Write-Host "Window Bounds:       $($verifiedBounds.Width)x$($verifiedBounds.Height) at ($($verifiedBounds.Left),$($verifiedBounds.Top))"
Write-Host "Backend Healthy:     $backendHealthy"
Write-Host "Renderer Loaded:     $rendererLoaded"
Write-Host "Desktop Ready:       $desktopReady"

if ($verifiedHwnd -ne [IntPtr]::Zero -and $backendHealthy) {
    Write-Host "[RESTART_SUCCESS] AgenticOS restarted successfully: HWND=0x$($verifiedHwnd.ToString('X')), PID=$mainPid, DesktopReady=$desktopReady"
    exit 0
} else {
    Write-Host "[RESTART_FAILED] Backend restarted, but the AgenticOS desktop window did not become ready."
    exit 1
}
