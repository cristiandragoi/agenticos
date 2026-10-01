# Test Romanian TTS routing
import requests
import json

base_url = "http://localhost:3002/api/voice/tts"
test_text = "Buna ziua"  # Simplified text for basic connectivity test

try:
    response = requests.post(base_url, headers={"Content-Type": "application/json"}, 
                            json={"text": test_text}, timeout=15)
    print("Status:", response.status_code)
    print("Response length (bytes):", len(response.content))
    if response.text:
        print("Content preview:", response.text[:200])
except Exception as e:
    print("Request error:", str(e)[:200])
