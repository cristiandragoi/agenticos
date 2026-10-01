"""Complete Piper Romanian synthesis test."""
import sys
sys.setrecursionlimit(200)

print("[*] Initializing Piper TTS synthesis test")
print()

# Step 1: Check piper_tts module availability
try:
    from piper_tts import pipeline
    from piper_tts.pipeline import SynthesizePipeline, SynthesizeWithVocoderPipeline
    print("[+] pipier TTS module imported successfully")
except ImportError as e:
    print(f"[-] pipier not available; skip to ONNX-only path")
    from onnxruntime import InferenceSession, SessionOptions
    
# Step 2: Load model and config
model_path = "D:/AgenticOS/server/node_modules/piper-bin/models/ro/ro_RO-mihai-medium.onnx"
config_path = "D:/AgenticOS/server/node_modules/piper-bin/configs/ro_RO-mihai-medium.onnx.json"

try:
    with open(config_path) as f:
        config = __import__('json').load(f)
    print(f"[+] Config loaded: {model_path}")
    print(f"  Sample rate: {config['audio']['sample_rate']} Hz")
    print(f"  Quality: {config['audio']['quality']}")
except Exception as e:
    print(f"[-] Config error: {e}")

# Step 3: Load ONNX model
try:
    sess = InferenceSession(model_path, providers=["CPUExecutionProvider"], sess_options=None)
    print(f"[+] Model loaded with ONNX Runtime providers")
except Exception as e:
    print(f"[-] Model load failed: {e}")

# Step 4: Test synthesis if phonemizer is available
try:
    from espeak_ng import ESPEAK_ANG
    
    # eSpeak NG supports Romanian voices via system DLL (.so/.dll)
    # Create synthesizer with eSpeak backend if available
    from piper_tts.synthesizer import create_synthesizer
    
    print(f"[+] espeak-ng Python module available")
except ImportError:
    print("[!] espeak_ng not installed; will skip phonemization check")

# Step 5: Full synthesis test if all components are ready
print()
print("=== Synthesis readiness ===")
print()
