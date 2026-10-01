import os
import subprocess
from pathlib import Path

# Paths from earlier verification
model_dir = "D:/AgenticOS/server/node_modules/piper-bin/models/ro/"
config_file = "node_modules/piper-bin/configs/ro_RO-mihai-medium.onnx.json"
output_file = "D:/AgenticOS/server/tmp/romanian-piper-test.wav"

# Ensure tmp exists
Path("tmp").mkdir(parents=True, exist_ok=True)

# Exact test payload
test_text = "Bună ziua. Acesta este un test pentru vocea românească Jarvis."

print("="*60)
print("Direct Piper CLI Romanian Synthesis Test")
print("="*60)
print()
print(f"piper.exe: C:\\Users\\cd-pr\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\piper.exe")
print(f"Model dir: {model_dir}")
print(f"Config: {config_file}")
print()
print(f"Input text: '{test_text}'")
print(f"Output: {output_file}")
print()

# Build and execute the direct piper CLI command
piper_exe = r'C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\piper.exe'
ro_model_bundle_path = model_dir + 'ro_RO-mihai-medium.onnx.json'

cmd = [
    piper_exe,
    'synthesize',
    f'--model={ro_model_bundle_path}',
    f'--output={output_file}',
    test_text
]

print(f"Command: {' '.join(cmd)}")
print()

result = subprocess.run(cmd, capture_output=True, text=True)

print(f"Exit code: {result.returncode}")
print()
if result.stdout:
    print("STDOUT:")
    print(result.stdout)

if result.stderr:
    print("STDERR:")
    print(result.stderr[:500])

print()

# Verify output WAV
wav_exists = Path(output_file).exists()
wav_size = 0 if not wav_exists else Path(output_file).stat().st_size

print(f"WAV file exists: {wav_exists}")
if wav_exists:
    print(f"WAV size (bytes): {wav_size:,} ({wav_size/1024:.1f} KB)")
else:
    print("  WAV not generated")

print()
