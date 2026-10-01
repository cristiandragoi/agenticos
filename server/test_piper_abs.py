"""Test Piper Windows synthesis with absolute paths."""
import subprocess
import sys

# Absolute, canonical paths from earlier verification
piper_exe = "C:\\Users\\cd-pr\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\piper.exe"
model_path = r"D:\AgenticOS\server\node_modules\piper-bin\models\ro\ro_RO-mihai-medium.onnx"
config_path = r"D:\AgenticOS\server\node_modules\piper-bin\configs\ro_RO-mihai-medium.onnx.json"
output_wav = r"D:\AgenticOS\server\tmp\romanian-piph-test.wav"

test_text = "Bună ziua. Acesta este un test pentru vocea românească Jarvis."

print("=== Piper Direct Synthesis Test ===")
print(f"Model: {model_path}")
print(f"Config: {config_path}")
print(f"Output: {output_wav}")
print()

# Ensure tmp exists  
import os
os.makedirs(os.path.dirname(output_wav), exist_ok=True)

# Run piper with exact argument arrays
cmd = [
    piper_exe,
    "--model", model_path,
    "--config", config_path,
    "--output-file", output_wav,
] + test_text.split()  # Text on command line
print(f"CMD: {' '.join(cmd)}")
print()

result = subprocess.run(cmd, capture_output=True, text=True)

# Verify results 
from pathlib import Path
wav_exists = Path(output_wav).exists()
wav_size = wav_exists and Path(output_wav).stat().st_size

print(f"Exit code: {result.returncode}")
if result.returncode:
    print("STDERR (truncated to 1000 chars):")
    print('\n'.join(line[:500] + '\n...' if len(line) > 500 else line for line in result.stderr.split('\n') if line)[:3])

print(f"WAV exists: {wav_exists}")
if wav_exists:
    print(f"WAV size: {wav_size:,} bytes ({wav_size/1024:.1f} KB)")
else:
    print("  WAV NOT GENERATED")
