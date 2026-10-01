"""Test direct TTS synthesis with Romanian model using ONNX Runtime and faster-whisper."""
import numpy as np
from onnxruntime import InferenceSession, SessionOptions

# Load configuration that tells us the sample rate and model details
import json
with open("D:/AgenticOS/server/node_modules/piper-bin/configs/ro_RO-mihai-medium.onnx.json") as f:
    config = json.load(f)
    
sample_rate = config['audio']['sample_rate']
phoneme_type = config['phoneme_type']

# Load the ONNX model
sess = InferenceSession(
    "D:/AgenticOS/server/node_modules/piper-bin/models/ro/ro_RO-mihai-medium.onnx",
    providers=['CPUExecutionProvider'],
    sess_options=SessionOptions()
)

print(f"✓ Model loaded successfully")
print(f"  Sample rate: {sample_rate} Hz")
print(f"  Phoneme type: {phoneme_type}")

# Get input signature
input_tensor = sess.get_inputs()[0]
print(f"Input shape requirement: {[list(input_tensor.shape)]}")
print(f"Input dtype: {input_tensor.type}, name: {input_tensor.name}")

# The model expects raw audio samples as first input, outputs generated audio
# piper-tts pipeline converts text→phonemes→raw audio→inference→wav
# We need the phoneme conversion step which piper CLI handles with whisper/espeak

# Check available outputs
output_names = [o.name for o in sess.get_outputs()]
print(f"Output names: {output_names}")
