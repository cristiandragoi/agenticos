$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = '"C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe" --remote-debugging-port=9222'
}
Write-Host "ReturnValue: $($res.ReturnValue) ProcessId: $($res.ProcessId)"
