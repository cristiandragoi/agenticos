"""Final Piper Romanian TTS synthesis test."""
import sys

sys.setrecursionlimit(200)

print("=" * 70)
print("FINAL: Piper Romanian TTS Synthesis Test")
print("=" * 70)
print()

# Step 1: Import piper-tts and verify Romanian model load
print("[*] Step 1: Loading pipier_tts module and Romanian model...")

try:
    from piper_tts import synthesizer, phoneme_converter
    
    print("  [OK] pipih_tts loaded successfully")
    print(f"      Located: {synthesizer.__file__}")
    
except ImportError as e1:
    print(f"  [-] Import failed: {e1}")
    # Try alternative import paths  
import warnings
warnings.filterwarnings('ignore')


# Step 2: Verify Python path has piper-tts
import site
print()
print("[*] Checking pipih_tts installation:")

# List installed packages to find exact location 
import subprocess
result = subprocess.run([sys.executable, "-m", "pip", "show", "piper-tts"], capture_output=True, text=True)
print(result.stdout)


# Step 3: Add sys.path override if needed  
import site
site.addsitedir("C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Lib/site-packages")

print()
print("[*] Re-importing with sys.path override...")

try:
    from piper_tts import TTSModel, get_speaks
    
    print("[OK] All imports successful")
    
except ImportError as e2:
    print(f"  Note: pipier modules may use internal paths; test full pipeline anyway")

print()


# Step 4: Test Romanian synthesis with exact payload  
test_text = "Bună ziua. Acesta este un test pentru vocea românească Jarvis."

synthesize_cmd = f'C:\Python314\python.exe D:/AgenticOS/server/test_piper_synthesis.py'
result = subprocess.run(synthesize_cmd, capture_output=True, text=True)

print(f'Synthesis result ({len(result.stdout)} bytes):')
print(result.stdout)
print()

