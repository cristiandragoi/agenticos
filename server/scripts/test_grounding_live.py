import os
import time
import json
import base64
import urllib.request
from pathlib import Path

# Load API key from server/.env
env_path = Path("D:/AgenticOS/server/.env")
api_key = None
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            api_key = line.split("=", 1)[1].strip()
            break

if not api_key:
    api_key = os.environ.get("OPENROUTER_API_KEY")

if not api_key:
    print("NO_API_KEY_FOUND")
    exit(1)

# Read real desktop screenshot
img_path = Path("D:/AgenticOS/server/data/real_screen_test.png")
if not img_path.exists():
    print("NO_SCREENSHOT_FOUND")
    exit(1)

b64_img = base64.b64encode(img_path.read_bytes()).decode("utf-8")

payload = {
    "model": "bytedance/ui-tars-1.5-7b",
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "You are a GUI grounding model. Looking at this 1920x1080 Windows desktop screenshot, locate the Windows Start button or taskbar icon on the screen. Output: click(start_box='(x, y)') with coordinates."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{b64_img}"
                    }
                }
            ]
        }
    ],
    "temperature": 0.0,
    "max_tokens": 128
}

req_data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(
    "https://openrouter.ai/api/v1/chat/completions",
    data=req_data,
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/simular-ai/Agent-S",
        "X-Title": "AgenticOS Agent-S Grounding"
    }
)

print("SENDING_REAL_GROUNDING_REQUEST: model=bytedance/ui-tars-1.5-7b resolution=1920x1080...")
t0 = time.perf_counter()
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        duration_ms = (time.perf_counter() - t0) * 1000
        status_code = resp.getcode()
        body = json.loads(resp.read().decode("utf-8"))
        print(f"HTTP_STATUS: {status_code}")
        print(f"GROUNDING_LATENCY_MS: {duration_ms:.2f}")
        choice = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"REAL_MODEL_RESPONSE: {choice}")
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8")
    print(f"HTTP_ERROR: {e.code} - {err_body}")
except Exception as e:
    print(f"REQUEST_FAILED: {e}")
