"""
qa/human-simulator/capture_desktop.py

High-reliability desktop observation and screenshot capture.
Attaches to WinSta0\\Default to ensure full interactive desktop access across all execution contexts.
Outputs clean JSON with foreground window, process, running apps, and captured screenshot.
"""

import sys
import os
import json
import time
import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# 1. Attach to interactive desktop session
try:
    hwinsta = user32.OpenWindowStationW("WinSta0", False, 0x037F)
    if hwinsta:
        user32.SetProcessWindowStation(hwinsta)
    hdesk = user32.OpenDesktopW("Default", 0, False, 0x01FF)
    if hdesk:
        user32.SetThreadDesktop(hdesk)
except Exception:
    pass

screenshot_path = sys.argv[1] if len(sys.argv) > 1 else ""

# 2. Get Foreground Window
hwnd_fg = user32.GetForegroundWindow()
fg_title = ""
fg_process = ""
fg_pid = 0

if hwnd_fg:
    length = user32.GetWindowTextLengthW(hwnd_fg)
    if length > 0:
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd_fg, buff, length + 1)
        fg_title = buff.value
    
    pid_c = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd_fg, ctypes.byref(pid_c))
    fg_pid = pid_c.value
    
    # Process name
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    hproc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, fg_pid)
    if hproc:
        try:
            exe_buff = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            if kernel32.QueryFullProcessImageNameW(hproc, 0, exe_buff, ctypes.byref(size)):
                fg_process = os.path.basename(exe_buff.value).replace('.exe', '')
        finally:
            kernel32.CloseHandle(hproc)

# 3. Enumerate relevant running processes & windows
running_processes = set()
windows = []

def enum_cb(hwnd, extra):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value
            
            p = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
            proc_name = ""
            h = kernel32.OpenProcess(0x1000, False, p.value)
            if h:
                try:
                    e_buff = ctypes.create_unicode_buffer(512)
                    s = wintypes.DWORD(512)
                    if kernel32.QueryFullProcessImageNameW(h, 0, e_buff, ctypes.byref(s)):
                        proc_name = os.path.basename(e_buff.value).replace('.exe', '')
                finally:
                    kernel32.CloseHandle(h)
            
            if proc_name:
                low = proc_name.lower()
                if any(x in low for x in ['agenticos', 'chrome', 'comet', 'whatsapp', 'msedge']):
                    running_processes.add(proc_name)
                    windows.append({"hwnd": hwnd, "title": title, "process": proc_name, "pid": p.value})
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

# 4. Capture Screenshot if path provided
has_screenshot = False
if screenshot_path:
    try:
        from PIL import ImageGrab
        im = ImageGrab.grab()
        # Save as JPEG for fast dashboard delivery
        out_jpg = screenshot_path
        if out_jpg.lower().endswith('.png'):
            out_jpg = out_jpg[:-4] + '.jpg'
        im.save(out_jpg, 'JPEG', quality=80)
        screenshot_path = out_jpg
        has_screenshot = os.path.exists(out_jpg) and os.path.getsize(out_jpg) > 1000
    except Exception as e:
        sys.stderr.write(f"Screenshot error: {e}\n")

# Fallback: if fg_process is empty, pick top matching window
if not fg_process and windows:
    fg_title = windows[0]["title"]
    fg_process = windows[0]["process"]
    fg_pid = windows[0]["pid"]

output = {
    "ForegroundTitle": fg_title,
    "ForegroundProcess": fg_process or "Desktop",
    "ForegroundPid": fg_pid,
    "RunningProcesses": sorted(list(running_processes)),
    "Windows": windows,
    "ScreenshotPath": screenshot_path if has_screenshot else "",
}

sys.stdout.write(json.dumps(output))
