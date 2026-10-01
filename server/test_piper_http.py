"""Test Piper TTS capabilities."""
import sys

print("=== Testing Piper TTS synthesis ===")
print()

# Test 1: Check piper_tts module import
try:
    from piper_tts import pipeline
    print("[+] pipier_tts library imported successfully")    
except ImportError as e:
    print(f"[-] pipier_tts not available; error: {e}")

# Test 2: Check phonemizer for espeak NG support
try:
    from phonemizer.factory import create_backend
    backend = create_backend("espeak://ro", language="ro")
    print(f"[+] phonemizer with espeak-ro loaded successfully")
except Exception as e:
    print(f"[-] phonemizer not available; error: {e}")

# Test 3: Load the ONNX model directly
try:
    from onnxruntime import InferenceSession
    
    model_path = "D:/AgenticOS/server/node_modules/piper-bin/models/ro/ro_RO-mihai-medium.onnx"
    sess = InferenceSession(model_path, 
                           providers=["CPUExecutionProvider"])
    print(f"[+] ONNX model loaded from: {model_path}")
    
    inputs = sess.get_inputs()
    outputs = sess.get_outputs()
    print(f"  Input signature: {[str(i.shape) for i in inputs]}")
    print(f"  Output count: {len(outputs)}")
    
except Exception as e:
    print(f"[-] Model load failed; error: {e}")

print()
print("=== Test complete ===")
