import sys
sys.path.insert(0, "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/lib/python3.11/site-packages")
from piper_tts import TTSModel
print("OK: piper_tts imported using Hermes venv site-packages")

# List exported utilities
public = [x for x in dir(sys.modules["piper_tts"]) if not x.startswith("_")]
for item in sorted(public):
    print(f"  - {item}")
