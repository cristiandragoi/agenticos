import time
import ctypes
from ctypes import wintypes
from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', wintypes.DWORD),
        ('biWidth', wintypes.LONG),
        ('biHeight', wintypes.LONG),
        ('biPlanes', wintypes.WORD),
        ('biBitCount', wintypes.WORD),
        ('biCompression', wintypes.DWORD),
        ('biSizeImage', wintypes.DWORD),
        ('biXPelsPerMeter', wintypes.LONG),
        ('biYPelsPerMeter', wintypes.LONG),
        ('biClrUsed', wintypes.DWORD),
        ('biClrImportant', wintypes.DWORD),
    ]

def capture_screen():
    t0 = time.perf_counter()
    
    # Attach to interactive desktop
    h_winsta = user32.OpenWindowStationW("WinSta0", False, 0x037F)
    if h_winsta:
        user32.SetProcessWindowStation(h_winsta)
    h_desk = user32.OpenDesktopW("Default", 0, False, 0x01FF)
    if h_desk:
        user32.SetThreadDesktop(h_desk)

    width = user32.GetSystemMetrics(0)
    height = user32.GetSystemMetrics(1)

    dc = user32.GetDC(0)
    mem_dc = gdi32.CreateCompatibleDC(dc)
    bitmap = gdi32.CreateCompatibleBitmap(dc, width, height)
    old_bitmap = gdi32.SelectObject(mem_dc, bitmap)

    # BitBlt from screen DC to memory DC
    SRCCOPY = 0x00CC0020
    gdi32.BitBlt(mem_dc, 0, 0, width, height, dc, 0, 0, SRCCOPY)

    # Get DIB bits
    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height # top-down
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0 # BI_RGB

    buffer_size = width * height * 4
    buffer = ctypes.create_string_buffer(buffer_size)

    DIB_RGB_COLORS = 0
    gdi32.GetDIBits(mem_dc, bitmap, 0, height, buffer, ctypes.byref(bmi), DIB_RGB_COLORS)

    # Convert buffer to PIL Image
    img = Image.frombuffer('RGBA', (width, height), buffer, 'raw', 'BGRA', 0, 1).convert('RGB')

    # Cleanup
    gdi32.SelectObject(mem_dc, old_bitmap)
    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(0, dc)

    dt = (time.perf_counter() - t0) * 1000
    return img, dt

if __name__ == "__main__":
    img, dt = capture_screen()
    print(f"REAL_SCREENSHOT_CAPTURED: dimensions={img.width}x{img.height}, latency_ms={dt:.2f}")
    img.save("D:/AgenticOS/server/data/real_screen_test.png")
    print("SAVED: D:/AgenticOS/server/data/real_screen_test.png")
