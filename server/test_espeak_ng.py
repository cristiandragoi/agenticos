"""Test rhapsy espeak-ng phonemizer availability."""
import sys
sys.setrecursionlimit(200)

try:
    from rhasspy_espeak_ng import ESPEAK_ANG
    
    print("[OK] rhasspy.espeex_ng imported successfully")
    
    tts = ESPEAK_ANG()
    print(f"[OK] ESPEAK_ANG instance created, type: {type(tts)}")
    
except ImportError as e1:
    print(f"[-] rhasspy_espeak_ng not importable; error: {e1}")

print()