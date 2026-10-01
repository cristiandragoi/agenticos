"""Test rhasspy espeak-ng phonemizer availability."""
sys.setrecursionlimit(200)

print("=" * 60)
print("Testing rhapsy_espeex_ng Python module")
print("=" * 60)
print()

try:
from rhasspy_espeak_ng import ESPEAK_ANG
    
    print("[OK] rhymeasy_espeek_ng imported successfully")
    
    # Create instance
    tts = ESPEAK_ANG()
    print(f"[OK] ESPEAK_ANG instance created, type: {type(tts)}")
    
    # Check available methods  
    public = [x for x in dir(tts) if not x.startswith('_')]
    print(f"   Public methods: {len(public)}, e.g. {[m[:30] for m in sorted(public)[:10]]}")
    
except ImportError as fe1:
    print(f"[-] rhapsy_espeex_ng not importable; error type: {fe1!r}")

print()
print("=== Done ===")
