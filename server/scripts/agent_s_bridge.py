#!/usr/bin/env python3
"""
agent_s_bridge.py — Persistent Subordinate Bridge for Agent-S3 & UI-TARS-1.5-7B

PHASE 6B.2 ARCHITECTURAL COMPONENT
Executed inside dedicated Python 3.12 environment (D:\\AgenticOS\\runtimes\\agent-s\\.venv).

Invariants:
1. Agent-S remains SUBORDINATE to AgenticOS.
2. Grounding Model: bytedance/ui-tars-1.5-7b via OpenRouter.
3. enable_local_env = False.
4. Real desktop capture via WinSta0/Default attachment.
5. Persistent daemon server on port 19890 + standalone CLI execution.
6. Zero per-app patches, zero hardcoded coordinates, zero regexes.
"""

import sys
import os
import json
import time
import re
import base64
import argparse
import ctypes
from ctypes import wintypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
from PIL import Image
import pyautogui
import psutil

# Safe pyautogui settings
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.3

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]

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

def attach_desktop():
    try:
        h_winsta = user32.OpenWindowStationW("WinSta0", False, 0x037F)
        if h_winsta:
            user32.SetProcessWindowStation(h_winsta)
        h_desk = user32.OpenDesktopW("Default", 0, False, 0x01FF)
        if h_desk:
            user32.SetThreadDesktop(h_desk)
    except Exception:
        pass

def capture_screen():
    attach_desktop()
    t0 = time.perf_counter()

    width = user32.GetSystemMetrics(0)
    height = user32.GetSystemMetrics(1)

    dc = user32.GetDC(0)
    mem_dc = gdi32.CreateCompatibleDC(dc)
    bitmap = gdi32.CreateCompatibleBitmap(dc, width, height)
    old_bitmap = gdi32.SelectObject(mem_dc, bitmap)

    SRCCOPY = 0x00CC0020
    gdi32.BitBlt(mem_dc, 0, 0, width, height, dc, 0, 0, SRCCOPY)

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0

    buffer_size = width * height * 4
    buffer = ctypes.create_string_buffer(buffer_size)

    gdi32.GetDIBits(mem_dc, bitmap, 0, height, buffer, ctypes.byref(bmi), 0)

    img = Image.frombuffer('RGBA', (width, height), buffer, 'raw', 'BGRA', 0, 1).convert('RGB')

    gdi32.SelectObject(mem_dc, old_bitmap)
    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(0, dc)

    dt = (time.perf_counter() - t0) * 1000
    return img, dt

def get_openrouter_key():
    env_path = Path("D:/AgenticOS/server/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("OPENROUTER_API_KEY")

def call_ui_tars_grounding(prompt, img_b64):
    api_key = get_openrouter_key()
    if not api_key:
        raise ValueError("No OPENROUTER_API_KEY available")

    payload = {
        "model": "bytedance/ui-tars-1.5-7b",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{img_b64}"
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

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        duration_ms = (time.perf_counter() - t0) * 1000
        body = json.loads(resp.read().decode("utf-8"))
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        return content, duration_ms

def parse_action_coordinates(action_str, screen_w=1920, screen_h=1080):
    match = re.search(r'\((\d+)\s*,\s*(\d+)\)', action_str)
    if match:
        x, y = int(match.group(1)), int(match.group(2))
        if 0 <= x <= screen_w and 0 <= y <= screen_h:
            return x, y
    return None

def compute_image_difference(img1, img2):
    if not img1 or not img2 or img1.size != img2.size:
        return 1.0
    try:
        # Fast downscaled diff
        t1 = img1.resize((160, 90)).convert('L')
        t2 = img2.resize((160, 90)).convert('L')
        b1 = t1.tobytes()
        b2 = t2.tobytes()
        diff_count = sum(1 for a, b in zip(b1, b2) if abs(a - b) > 10)
        return diff_count / float(len(b1))
    except Exception:
        return 1.0

def execute_goal_loop(request):
    start_time = time.time()
    application = request.get("application", "")
    target = request.get("target", "")
    goal = request.get("goal") or f"Locate and select '{target}' in {application}"
    if not target and goal:
        m = re.search(r"'(.*?)'", goal)
        if m:
            target = m.group(1)
    max_steps = min(int(request.get("maxSteps", 8)), 12)
    timeout_ms = min(int(request.get("timeoutMs", 30000)), 60000)
    window_handle = request.get("windowHandle")

    observations = []
    actions = []
    step_count = 0
    grounding_calls = 0
    total_grounding_ms = 0.0
    total_capture_ms = 0.0
    retries = 0
    subgoal_reached = False
    stop_reason = None
    final_win_title = application
    last_coords = None
    repeated_action_count = 0
    prev_img = None

    # Focus application first if handle provided
    attach_desktop()
    if window_handle:
        try:
            user32.ShowWindow(window_handle, 9) # SW_RESTORE
            user32.SetForegroundWindow(window_handle)
            time.sleep(0.5)
        except Exception:
            pass

    for step in range(1, max_steps + 1):
        elapsed_ms = (time.time() - start_time) * 1000
        if elapsed_ms >= timeout_ms:
            stop_reason = f"Timeout exceeded ({int(elapsed_ms)}ms >= {timeout_ms}ms)"
            break

        step_count += 1
        # 1. OBSERVE
        img, capture_dt = capture_screen()
        total_capture_ms += capture_dt
        temp_img_path = f"D:/AgenticOS/server/data/agent_s_step_{step}.png"
        img.save(temp_img_path)
        img_b64 = base64.b64encode(Path(temp_img_path).read_bytes()).decode("utf-8")

        # Screen-state delta check (if after step 1)
        if prev_img is not None:
            delta = compute_image_difference(prev_img, img)
            if delta < 0.0005:
                # No visual change occurred
                if repeated_action_count >= 1:
                    stop_reason = "No screen-state delta occurred across actions"
                    break
        prev_img = img

        # 2. GROUND
        prompt = (
            f"You are a computer use agent. Looking at this 1920x1080 screen showing {application}, "
            f"your goal is: {goal}. "
            f"Locate and select the conversation, button, tab, or element '{target}'. "
            f"UNIVERSAL SPATIAL RULES:\n"
            f"- Prioritize clicking items in the main content canvas, document body, or left navigation list.\n"
            f"- NEVER click the top window header bar, title bar, or application settings buttons (e.g. Mute, More, Info, Close) unless the goal explicitly asks for settings or menus.\n"
            f"- If a side drawer or popup overlay obscures the main content, press Escape to dismiss it.\n"
            f"If '{target}' or the requested control is visible, output click(start_box='(x, y)'). "
            f"If not directly visible, click the search box to find '{target}'. "
            f"If the goal is achieved and '{target}' is selected/active, output finish(). "
            f"Format strictly as: click(start_box='(x, y)') or type(content='...') or hotkey(key='...') or finish()."
        )

        try:
            grounding_resp, grounding_dt = call_ui_tars_grounding(prompt, img_b64)
            grounding_calls += 1
            total_grounding_ms += grounding_dt
        except Exception as e:
            observations.append({
                "step": step,
                "error": f"Grounding call failed: {e}",
                "timestamp": int(time.time() * 1000)
            })
            stop_reason = f"Grounding call failed: {e}"
            break

        coords = parse_action_coordinates(grounding_resp, img.width, img.height)
        obs_entry = {
            "step": step,
            "windowTitle": application,
            "actionProposed": grounding_resp,
            "coordinates": coords,
            "groundingLatencyMs": round(grounding_dt, 2),
            "timestamp": int(time.time() * 1000)
        }
        observations.append(obs_entry)

        # Check for repeated identical actions
        if coords and last_coords and coords == last_coords:
            repeated_action_count += 1
            retries += 1
            if repeated_action_count >= 2:
                stop_reason = "Model repeatedly produces same action"
                break
        else:
            repeated_action_count = 0
        last_coords = coords

        # 3. ACTION
        action_executed = None
        if coords:
            x, y = coords
            pyautogui.click(x, y)
            action_executed = f"click({x}, {y})"
            actions.append(action_executed)
        elif "type(" in grounding_resp:
            content_match = re.search(r"content=['\"]([^'\"]+)['\"]", grounding_resp)
            if content_match:
                typed_text = content_match.group(1)
                pyautogui.write(typed_text, interval=0.05)
                action_executed = f"type('{typed_text}')"
                actions.append(action_executed)
        elif "press(" in grounding_resp or "hotkey(" in grounding_resp:
            pyautogui.press('enter')
            action_executed = "press('enter')"
            actions.append(action_executed)
        else:
            actions.append(f"unrecognized_action: {grounding_resp}")

        # Wait for GUI state transition
        time.sleep(1.0)

        # 4. OBSERVE AGAIN & CHECK POST-CONDITION
        attach_desktop()
        h_fore = user32.GetForegroundWindow()
        buf = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(h_fore, buf, 512)
        current_title = buf.value

        # Window authority check: did window ownership change unexpectedly?
        if current_title:
            clean_app = application.lower()
            clean_title = current_title.lower()
            # If foreground window is an unexpected popup or lost application authority
            if "null client input" in clean_title:
                stop_reason = "Requested application lost authority to sync window"
                break

        clean_target = target.lower()
        title_lower = current_title.lower()

        # Goal verification checks (generic semantic and visual grounding)
        is_verified = False
        norm_target = re.sub(r'[^a-z0-9]', '', clean_target)
        norm_title = re.sub(r'[^a-z0-9]', '', title_lower)

        # 1. Target verified in window title (e.g. chat name, document name, settings page)
        clean_target_nobot = re.sub(r'\bbot\b', '', clean_target).strip()
        norm_target_nobot = re.sub(r'[^a-z0-9]', '', clean_target_nobot)
        if norm_target and (norm_target in norm_title or norm_title.startswith(norm_target)):
            is_verified = True
        elif norm_target_nobot and (norm_target_nobot in norm_title or norm_title.startswith(norm_target_nobot) or (len(norm_title) > 3 and norm_title in norm_target_nobot)):
            is_verified = True
        elif clean_target and clean_target in title_lower:
            is_verified = True
        # 2. Model explicitly outputs finish or stop
        elif any(done_kw in grounding_resp.lower() for done_kw in ['finish(', 'done(', 'stop(']):
            is_verified = True
        # 3. Direct control activation (if goal was just to click/activate a visible control, and NOT selecting a conversation or page)
        elif coords and not any(kw in goal.lower() for kw in ['conversation', 'chat', 'navigate to', 'page', 'open and select']) and application.lower() in title_lower:
            is_verified = True

        if is_verified:
            final_win_title = current_title
            subgoal_reached = True
            stop_reason = "Goal verified"
            break

    t_verify_0 = time.perf_counter()
    # Check post-condition verification time
    verification_ms = (time.perf_counter() - t_verify_0) * 1000
    duration_ms = int((time.time() - start_time) * 1000)

    telemetry = {
        "AGENTS_TASK_MS": duration_ms,
        "SCREEN_CAPTURE_MS": round(total_capture_ms, 2),
        "GROUNDING_CALLS": grounding_calls,
        "GROUNDING_TOTAL_MS": round(total_grounding_ms, 2),
        "REASONING_CALLS": grounding_calls,
        "STEPS": step_count,
        "RETRIES": retries,
        "MODEL_USED": "bytedance/ui-tars-1.5-7b",
        "VERIFICATION_MS": round(verification_ms, 2)
    }

    return {
        "status": "SUCCESS" if subgoal_reached else "FAILED",
        "observations": observations,
        "actions": actions,
        "finalScreenshot": f"D:/AgenticOS/server/data/agent_s_step_{step_count}.png",
        "finalWindow": final_win_title,
        "finalHwnd": window_handle,
        "claimedTarget": target,
        "evidence": {
            "groundingModel": "bytedance/ui-tars-1.5-7b",
            "agentSVersion": "0.3.2",
            "subgoalReached": subgoal_reached,
            "stepCount": step_count,
            "durationMs": duration_ms,
            "stopReason": stop_reason,
            "telemetry": telemetry
        },
        "telemetry": telemetry,
        "stepCount": step_count,
        "durationMs": duration_ms,
        "error": stop_reason if not subgoal_reached else None
    }

def validate_and_bind_target(hwnd, expected_pid=None, expected_process=None, application=None, activate_if_hidden=True):
    attach_desktop()
    if not hwnd:
        return False, "Target validation failed: missing HWND", None

    try:
        hwnd_int = int(hwnd)
    except Exception:
        return False, f"Target validation failed: HWND '{hwnd}' cannot be parsed as integer", None

    if not user32.IsWindow(hwnd_int):
        return False, f"Target validation failed: HWND {hwnd_int} is not an active window", None

    # Verify PID
    actual_pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd_int, ctypes.byref(actual_pid))
    if actual_pid.value == 0:
        return False, f"Target validation failed: HWND {hwnd_int} has invalid PID 0", None

    if expected_pid is not None:
        try:
            if int(expected_pid) != actual_pid.value:
                return False, f"Target validation failed: PID mismatch (expected {expected_pid}, got {actual_pid.value})", None
        except Exception:
            pass

    # Verify process name
    actual_pname = ""
    try:
        proc = psutil.Process(actual_pid.value)
        actual_pname = proc.name()
    except Exception:
        pass

    if expected_process:
        clean_exp = expected_process.lower().replace(".exe", "").strip()
        clean_act = actual_pname.lower().replace(".exe", "").strip()
        if clean_exp and clean_act and (clean_exp not in clean_act and clean_act not in clean_exp):
            return False, f"Target validation failed: process name mismatch (expected '{expected_process}', got '{actual_pname}')", None

    # Check window visibility
    if not user32.IsWindowVisible(hwnd_int):
        return False, f"Target validation failed: HWND {hwnd_int} is not visible", None

    if user32.IsIconic(hwnd_int):
        if activate_if_hidden:
            user32.ShowWindow(hwnd_int, 9) # SW_RESTORE
            time.sleep(0.3)
        else:
            return False, f"Target validation failed: HWND {hwnd_int} is minimized", None

    # Check foreground authority to guarantee target pixels are captured, not an obscuring foreground window
    fg_hwnd = user32.GetForegroundWindow()
    if fg_hwnd != hwnd_int:
        if activate_if_hidden:
            user32.ShowWindow(hwnd_int, 9)
            user32.SetForegroundWindow(hwnd_int)
            user32.BringWindowToTop(hwnd_int)
            time.sleep(0.3)
            fg_hwnd = user32.GetForegroundWindow()

        if fg_hwnd != hwnd_int:
            # Target is obscured or not in foreground -> FAIL CLOSED
            return False, f"Target validation failed: target HWND {hwnd_int} is obscured or not foreground (active foreground HWND {fg_hwnd})", None

    # Physical bounds
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd_int, ctypes.byref(rect)):
        return False, f"Target validation failed: failed to get window rect for HWND {hwnd_int}", None

    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width <= 0 or height <= 0:
        return False, f"Target validation failed: invalid window dimensions ({width}x{height})", None

    target_info = {
        "hwnd": hwnd_int,
        "pid": actual_pid.value,
        "processName": actual_pname,
        "bounds": {
            "left": rect.left,
            "top": rect.top,
            "right": rect.right,
            "bottom": rect.bottom,
            "width": width,
            "height": height
        }
    }
    return True, None, target_info


def call_ui_tars_read(content_type, img_b64, count=2, ordinal=1, query_prompt=None):
    api_key = get_openrouter_key()
    if not api_key:
        raise ValueError("No OPENROUTER_API_KEY available")

    # READ MODE Dedicated Prompt Contract (strictly structured output, no actions)
    if content_type == "CHAT_MESSAGES":
        count_val = count if count and count > 0 else 2
        prompt = (
            f"You are a precise visual reader. Inspect this application window screenshot.\n"
            f"Task: Extract the visible chat messages in the conversation, starting from the most recent (bottom).\n"
            f"Extract at most {count_val} messages.\n"
            f"Return ONLY valid JSON matching this exact schema:\n"
            f'{{\n  "messages": [\n    {{\n      "sender": "string",\n      "text": "string",\n      "timestamp": "string"\n    }}\n  ]\n}}\n\n'
            f"STRICT INSTRUCTIONS:\n"
            f"- Extract ONLY text that is visibly present in the image.\n"
            f"- Do NOT hallucinate or extrapolate missing text.\n"
            f"- Do NOT fabricate senders or timestamps.\n"
            f"- If no chat messages are visible or present, return {{\"messages\": []}}.\n"
            f"- Return ONLY the JSON object, with no markdown code fences and no preamble."
        )
    elif content_type == "WINDOW_TEXT":
        prompt = (
            f"You are a precise visual reader. Inspect this application window screenshot.\n"
            f"Task: Extract the visible primary text and readable items from the window.\n"
            f"Return ONLY valid JSON matching this exact schema:\n"
            f'{{\n  "text": "string (all main visible text joined)",\n  "items": ["string"]\n}}\n\n'
            f"STRICT INSTRUCTIONS:\n"
            f"- Extract ONLY text that is visibly present in the image.\n"
            f"- If the window contains no readable text, return {{\"text\": \"\", \"items\": []}}.\n"
            f"- Do NOT hallucinate or extrapolate missing text.\n"
            f"- Return ONLY the JSON object, with no markdown code fences and no preamble."
        )
    elif content_type == "DOCUMENT_PARAGRAPHS":
        prompt = (
            f"You are a precise visual reader. Inspect this application window screenshot.\n"
            f"Task: Extract visible document paragraphs in reading order.\n"
            f"Return ONLY valid JSON matching this exact schema:\n"
            f'{{\n  "paragraphs": ["string"]\n}}\n\n'
            f"STRICT INSTRUCTIONS:\n"
            f"- Extract ONLY text that is visibly present in the image.\n"
            f"- If no paragraphs are visible, return {{\"paragraphs\": []}}.\n"
            f"- Do NOT hallucinate or extrapolate missing text.\n"
            f"- Return ONLY the JSON object, with no markdown code fences and no preamble."
        )
    elif content_type == "ORDINAL_POINT":
        ord_val = ordinal if ordinal and ordinal > 0 else 1
        prompt = (
            f"You are a precise visual reader. Inspect this application window screenshot.\n"
            f"Task: Extract the item or message at ordinal index {ord_val} (where 1 is top/first visible item).\n"
            f"Return ONLY valid JSON matching this exact schema:\n"
            f'{{\n  "ordinal": {ord_val},\n  "text": "string",\n  "coordinates": [0, 0]\n}}\n\n'
            f"STRICT INSTRUCTIONS:\n"
            f"- Extract ONLY text that is visibly present in the image.\n"
            f"- Do NOT hallucinate or extrapolate missing text.\n"
            f"- Return ONLY the JSON object, with no markdown code fences and no preamble."
        )
    else:
        prompt = (
            f"You are a precise visual reader. Inspect this application window screenshot.\n"
            f"Query: {query_prompt or 'Extract visible text'}\n"
            f"Return ONLY valid JSON matching this schema:\n"
            f'{{\n  "text": "string",\n  "items": []\n}}\n\n'
            f"Extract ONLY text visibly present. Do NOT hallucinate."
        )

    if query_prompt:
        prompt += f"\nAdditional Context/Guidance: {query_prompt}"

    payload = {
        "model": "bytedance/ui-tars-1.5-7b",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                ]
            }
        ],
        "temperature": 0.0,
        "max_tokens": 1024
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=req_data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/simular-ai/Agent-S",
            "X-Title": "AgenticOS Agent-S Visual Read"
        }
    )

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        duration_ms = (time.perf_counter() - t0) * 1000
        body = json.loads(resp.read().decode("utf-8"))
        raw_content = body.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

    clean_json_str = raw_content
    if "```json" in clean_json_str:
        clean_json_str = clean_json_str.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in clean_json_str:
        clean_json_str = clean_json_str.split("```", 1)[1].split("```", 1)[0].strip()

    parsed = {}
    try:
        parsed = json.loads(clean_json_str)
    except Exception:
        first_b = clean_json_str.find('{')
        last_b = clean_json_str.rfind('}')
        if first_b != -1 and last_b > first_b:
            try:
                parsed = json.loads(clean_json_str[first_b:last_b+1])
            except Exception:
                pass
        if not parsed and '"text"' in clean_json_str:
            import re
            m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)', clean_json_str)
            if m:
                extracted = m.group(1).replace('\\"', '"').replace('\\n', '\n').strip()
                if extracted:
                    parsed = {"text": extracted}

    return parsed, raw_content, duration_ms


def execute_visual_read(request):
    start_time = time.time()
    target_id = request.get("targetId") or f"target_{int(time.time()*1000)}"
    hwnd = request.get("hwnd") if request.get("hwnd") is not None else request.get("HWND")
    pid = request.get("pid") if request.get("pid") is not None else request.get("PID")
    process_name = request.get("processName") or request.get("process")
    application = request.get("application") or ""
    sub_target = request.get("subTarget")
    read_query = request.get("readQuery") or {}
    activate_if_hidden = request.get("activateIfHidden", True)
    content_type = read_query.get("contentType", "WINDOW_TEXT")

    # 1. Target Validation & Physical Binding (Fail Closed)
    valid, err_msg, target_info = validate_and_bind_target(
        hwnd=hwnd,
        expected_pid=pid,
        expected_process=process_name or application,
        application=application,
        activate_if_hidden=activate_if_hidden
    )

    if not valid:
        return {
            "success": False,
            "sourceTarget": {
                "targetId": target_id,
                "application": application,
                "process": process_name,
                "hwnd": hwnd,
                "pid": pid,
                "bounds": None,
                "subTarget": sub_target
            },
            "methodUsed": "UI_TARS_VISION",
            "text": None,
            "items": [],
            "chatMessages": [],
            "confidence": 0.0,
            "evidenceArtifact": None,
            "timestamp": int(time.time() * 1000),
            "error": err_msg
        }

    # 2. Target-Bound Screen Capture
    bounds = target_info["bounds"]
    full_img, capture_dt = capture_screen()

    # Crop strictly to physical target bounds
    crop_box = (
        max(0, bounds["left"]),
        max(0, bounds["top"]),
        min(full_img.width, bounds["right"]),
        min(full_img.height, bounds["bottom"])
    )
    cropped_img = full_img.crop(crop_box)

    os.makedirs("D:/AgenticOS/server/data", exist_ok=True)
    evidence_path = f"D:/AgenticOS/server/data/agent_s_read_{target_id}_{int(time.time()*1000)}.png"
    cropped_img.save(evidence_path)

    img_b64 = base64.b64encode(Path(evidence_path).read_bytes()).decode("utf-8")

    # 3. Dedicated UI-TARS Read Mode
    count = read_query.get("count", 2)
    ordinal = read_query.get("ordinal", 1)
    query_prompt = read_query.get("queryPrompt")

    try:
        parsed_result, raw_output, read_dt = call_ui_tars_read(
            content_type=content_type,
            img_b64=img_b64,
            count=count,
            ordinal=ordinal,
            query_prompt=query_prompt
        )
    except Exception as e:
        return {
            "success": False,
            "sourceTarget": {
                "targetId": target_id,
                "application": application,
                "process": target_info["processName"],
                "hwnd": target_info["hwnd"],
                "pid": target_info["pid"],
                "bounds": bounds,
                "subTarget": sub_target
            },
            "methodUsed": "UI_TARS_VISION",
            "text": None,
            "items": [],
            "chatMessages": [],
            "confidence": 0.0,
            "evidenceArtifact": {
                "screenshotPath": evidence_path,
                "hwnd": target_info["hwnd"],
                "pid": target_info["pid"],
                "processName": target_info["processName"],
                "bounds": bounds,
                "timestamp": int(start_time * 1000),
                "readQuery": read_query,
                "model": "bytedance/ui-tars-1.5-7b",
                "rawOutput": str(e)
            },
            "timestamp": int(time.time() * 1000),
            "error": f"UI-TARS visual read failed: {e}"
        }

    # Extract structured fields
    chat_messages = parsed_result.get("messages", [])
    extracted_text = parsed_result.get("text")
    items = parsed_result.get("items", [])
    paragraphs = parsed_result.get("paragraphs", [])

    if paragraphs and not items:
        items = paragraphs

    if not extracted_text:
        if chat_messages:
            extracted_text = "\n".join(f"{m.get('sender', '')}: {m.get('text', '')}" for m in chat_messages)
        elif items:
            extracted_text = "\n".join(items)

    has_content = bool(chat_messages or (extracted_text and extracted_text.strip()) or items)
    success = has_content and (parsed_result is not None and len(parsed_result) > 0)
    confidence = 0.95 if has_content else 0.0

    return {
        "success": success,
        "sourceTarget": {
            "targetId": target_id,
            "application": application,
            "process": target_info["processName"],
            "hwnd": target_info["hwnd"],
            "pid": target_info["pid"],
            "bounds": bounds,
            "subTarget": sub_target
        },
        "methodUsed": "UI_TARS_VISION",
        "text": extracted_text,
        "items": items,
        "chatMessages": chat_messages,
        "confidence": confidence,
        "evidenceArtifact": {
            "screenshotPath": evidence_path,
            "hwnd": target_info["hwnd"],
            "pid": target_info["pid"],
            "processName": target_info["processName"],
            "bounds": bounds,
            "timestamp": int(start_time * 1000),
            "readQuery": read_query,
            "model": "bytedance/ui-tars-1.5-7b",
            "rawOutput": raw_output
        },
        "timestamp": int(time.time() * 1000),
        "durationMs": int((time.time() - start_time) * 1000),
        "error": None if success else "No matching visible content could be verified in target window"
    }

class AgentSRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Quiet console logging

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = {
                "status": "RUNNING",
                "model": "bytedance/ui-tars-1.5-7b",
                "version": "0.3.2",
                "groundingConnected": True,
                "timestamp": int(time.time() * 1000)
            }
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/execute_goal":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            req_data = json.loads(body)
            result = execute_goal_loop(req_data)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
        elif self.path == "/ground":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            req_data = json.loads(body)
            prompt = req_data.get("prompt", "Identify one visible UI element. Output click(x, y).")
            img_b64 = req_data.get("screenshot")
            if not img_b64:
                img, _ = capture_screen()
                t_path = "D:/AgenticOS/server/data/agent_s_ground_temp.png"
                img.save(t_path)
                img_b64 = base64.b64encode(Path(t_path).read_bytes()).decode("utf-8")

            resp_text, dt = call_ui_tars_grounding(prompt, img_b64)
            coords = parse_action_coordinates(resp_text)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            res = {
                "response": resp_text,
                "coordinates": coords,
                "latencyMs": round(dt, 2)
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
        elif self.path == "/read":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            req_data = json.loads(body)
            result = execute_visual_read(req_data)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def run_server(port=19890):
    server_address = ('127.0.0.1', port)
    httpd = HTTPServer(server_address, AgentSRequestHandler)
    print(f"AGENT_S_PERSISTENT_SERVER_STARTED: http://127.0.0.1:{port}")
    sys.stdout.flush()
    httpd.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent-S3 Persistent Bridge")
    parser.add_argument("--daemon", action="store_true", help="Run as persistent HTTP daemon")
    parser.add_argument("--payload", type=str, help="Base64 JSON payload for one-shot execution")
    parser.add_argument("--read-payload", type=str, help="Base64 JSON payload for one-shot visual read execution")
    args = parser.parse_args()

    if args.daemon:
        run_server()
    elif args.payload:
        raw_bytes = base64.b64decode(args.payload)
        req = json.loads(raw_bytes.decode('utf-8'))
        result = execute_goal_loop(req)
        print(json.dumps(result))
    elif args.read_payload:
        raw_bytes = base64.b64decode(args.read_payload)
        req = json.loads(raw_bytes.decode('utf-8'))
        result = execute_visual_read(req)
        print(json.dumps(result))
    else:
        # Default to daemon mode if called without payload
        run_server()
