"""Direct Piper Romanian TTS test with eSpeak NG phonemization."""
import sys
from pathlib import Path

sys.setrecursionlimit(200)

print("=" * 64)
print("Piper TTS Direct Synthesis Test — Romanian Voice")
print("=" * 64)
print()

# Step 1: Import pipier-tts and check available utilities
print("[*] Step 1: Checking pipier-tts module availability...")
try:
    from piper_tts import pipeline, TTSModel, SynthesizePipeline, SynthesizeWithVocoderPipeline
    print("  [OK] pipier_tts imported — checking available entry points:")
    
    # List public API of pipier_tts package
    print(f"  Public members: {[x for x in dir(pipeline) if not x.startswith('_')]}")
except ImportError as e1:
    print(f"  [!] Import failed: {e1}")
    import traceback; traceback.print_exc()
    
# Step 2: Try rhasspy_espeak_ang phonemizer (for eSpeak NG Romanian)  
print()
print("[*] Step 2: Loading eSpeak NG phonemizer for Romanian (ro)...")

try:
    # Check if espeak-ng Python binding is available via rhasspy or direct import
    from rhasspy_espeak_ng import ESPEAK_ANG
    
    sample = "Hello"
    tts = ESPEAK_ANG()
    tts.load_data("ro_RO", "ro")  # Romanian language code
    phonemes = tts.phonemize_with_punctuation(sample)
    print(f"  [OK] eSpeakNG imported — phonemization test:")
    print(f"     Input:  {sample}")
    print(f"     Phonemes: {phonemes}")
    
except ImportError as fe1:
    print(f"  [!] rhasspy_espeak_ng not directly importable")

try:
    # Try importing espeak-ng via piper_tts phoneme converter  
    from piper_tts.phoneme_converter import get_phoneme_converter
    
    converter = get_phoneme_converter("espeak", language="ro")
    print(f"  [OK] pipier-tts phoneme converter available for 'espeak' backend with Romanian")
    
    # Test phoneme conversion  
    sample_text = "Bună ziua"
    phones = converter.phonemize_with_punctuation(sample_text)
    print(f"     Example: '{sample_text}' → '{phones}'")
except Exception as fe2:
    print(f"  [!] Phoneme converter check failed: {fe2}")

print()

# Step 3: List available model files 
model_dir = Path("node_modules/piper-bin/models/ro")
config_file = model_dir / "ro_RO-mihai-medium.onnx.json"

print("[*] Step 3: Checking model file availability...")
if (model_dir / "ro_RO-mihai-medium.onnx").exists():
    import os
    size_mb = os.path.getsize("node_modules/piper-bin/models/ro/ro_RO-mihai-medium.onnx") / (1024*1024)
    print(f"  [OK] Model exists: ro_RO-mihai-medium.onnx ({size_mb:.1f} MB)")
else:
    print(f"  [!] Model not found at node_modules/piper-bin/models/ro/")

if config_file.exists():
    import json
    with open(config_file) as f:
        cfg = json.load(f)
    print(f"  [OK] Config exists: ro_RO-mihai-medium.onnx.json")
    print(f"     Sample rate: {cfg['audio']['sample_rate']} Hz, Quality: {cfg['audio']['quality']}")
else:
    print(f"  [!] Config not found")

print()

# Step 4: Final summary  
print("=" * 64)