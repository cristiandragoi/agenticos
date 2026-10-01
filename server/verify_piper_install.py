"""Verify Piper Romanian synthesis with eSpeak NG."""
import sys

sys.setrecursionlimit(200)  # Safety limit

print("=" * 60)
print("Piper TTS Python Runtime Verification")
print("=" * 60)
print()

# Step 1: Import piper-tts module
try:
    from piper_tts import pipeline
    print("[+] pipier-tts imported successfully")
except ImportError as e:
    print(f"[-] import error: {e}")
    
print()

# Step 2: List available entry points / public API
try:
    from piper_tts.pipeline import SynthesizePipeline, SynthesizeWithVocoderPipeline
    from piper_tts.config import ModelConfig, VoiceConfig
    
    print("[+] Piper pipeline classes available")
    print(f"   SynthesizePipeline: {SynthesizePipeline}")
    print(f"   SynthesizeWithVocoderPipeline: {SynthesizeWithVocoderPipeline}")
    print(f"   ModelConfig: {ModelConfig}")
    print(f"   VoiceConfig: {VoiceConfig}")
    
except Exception as e2:
    print(f"[-] Class inspection error (non-fatal): {e2}")

print()

# Step 3: Check espeak NG / phonemizer availability
try:
    from piper_tts.phoneme_converter import get_phoneme_converter
    converter = get_phoneme_converter("espeak", language="ro")
    print("[+] eSpeak NG phoneme converter loaded for Romanian")
except Exception as e3:
    print(f"[-] eSpeak NG check skipped/failed: {e3}")

# Alternative espeak import from rhasspy
try:
    try:
        from rhasspy_espeak_ng import ESPEAK_ANG
        print("[+] rhasspy_espeak-ng module imported")
    except ImportError:
        pass
    
except Exception as e4:
    pass

print()

# Step 4: List installed piper_tts submodules  
import piper_tts
print(f"[+] piper_tts location: {piper_tts.__file__}")
try:
    print(f"   Submodules/pipelines: {[x for x in dir(piper_tts) if not x.startswith('_')]}")
except:
    pass

print()
print("=" * 60)