import subprocess
import sys
sys.path.insert(0, "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Lib/site-packages")

# Model and config paths from verified earlier
model_path = r"D:\AgenticOS\server\node_modules\piper-bin\models\ro\ro_RO-mihai-medium.onnx"
config_path = model_path.replace(".onnx", ".onnx.json")
output_wav = r"D:\AgenticOS\server\tmp\romanian-piper-test.wav"

# Test payload
test_text = (
    "Bună ziua. Acesta este un test pentru vocea românească Jarvis."
)

print("=== Direct Piper Windows Synthesis ===")
print()
print(f"Model exists: {__import__('os').path.exists(model_path)}")
print(f"Config exists: {__import__('os').path.exists(config_path)}")
print(f"Output path: {output_wav}")
print()

# Execute piper via subprocess with argument array from native Python
piper_exe = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\piper.exe"

import tempfile
with open(config_path, 'rb') as f:
    config_bytes = f.read()

# Write model to temp location since piper expects file paths, not just references
import os
import sys
onnx_sess_location = r"D:\AgenticOS\server\node_modules\piper-bin\models\ro\ro_RO-mihai-medium.onnx"
config_json_located = r"D:\AgenticOS\server\node_modules\piper-bin\node_modules\piper-bin/configs/ro_RO-mihai-medium.onnx.json"
