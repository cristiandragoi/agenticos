import subprocess, json

cmd = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', r'D:\AgenticOS\server\scripts\list_desktop_windows.ps1']
out = subprocess.check_output(cmd).decode('utf-8', errors='ignore')
idx1 = out.find('[')
idx2 = out.rfind(']')
if idx1 >= 0 and idx2 > idx1:
    wins = json.loads(out[idx1:idx2+1])
    for w in wins:
        print(f"HWND: {w.get('hwnd')}, PID: {w.get('pid')}, Process: {w.get('process')}, Title: {w.get('title')}")
