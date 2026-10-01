"""
Piper TTS synthesis script for AgenticOS.
Usage: python piper_tts.py --text "..." --model-path /path/to/model.onnx --config-path /path/to/model.onnx.json --output /path/to/output.wav

Outputs a WAV file. Returns JSON status on stdout (last line), WAV bytes to output file.
"""
import sys
import os
import json
import argparse
import time
import io

def main():
    parser = argparse.ArgumentParser(description='Piper TTS Synthesis')
    parser.add_argument('--text', type=str, required=True, help='Text to synthesize')
    parser.add_argument('--model-path', type=str, required=True, help='Path to .onnx model')
    parser.add_argument('--config-path', type=str, required=True, help='Path to .onnx.json config')
    parser.add_argument('--output', type=str, required=True, help='Output WAV file path')
    parser.add_argument('--timeout', type=int, default=30, help='Synthesis timeout in seconds')
    args = parser.parse_args()

    # Validate inputs
    if not args.text or not args.text.strip():
        print(json.dumps({'error': 'No text provided', 'success': False}))
        sys.exit(1)

    if not os.path.exists(args.model_path):
        print(json.dumps({'error': f'Model not found: {args.model_path}', 'success': False}))
        sys.exit(1)

    if not os.path.exists(args.config_path):
        print(json.dumps({'error': f'Config not found: {args.config_path}', 'success': False}))
        sys.exit(1)

    model_size = os.path.getsize(args.model_path)
    if model_size < 1_000_000:
        print(json.dumps({'error': f'Model file too small ({model_size} bytes), possibly corrupted', 'success': False}))
        sys.exit(1)

    # Load config to get sample rate
    try:
        with open(args.config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        sample_rate = config.get('audio', {}).get('sample_rate', 22050)
        num_speakers = config.get('num_speakers', 1)
    except Exception as e:
        print(json.dumps({'error': f'Failed to load config: {e}', 'success': False}))
        sys.exit(1)

    try:
        from piper.voice import PiperVoice
    except ImportError:
        try:
            import piper
            PiperVoice = piper.PiperVoice
        except (ImportError, AttributeError):
            print(json.dumps({'error': 'piper-tts package not installed. Run: pip install piper-tts', 'success': False}))
            sys.exit(1)

    start_t = time.time()
    try:
        voice = PiperVoice.load(args.model_path, config_path=args.config_path, use_cuda=False)
    except Exception as e:
        print(json.dumps({'error': f'Failed to load Piper voice: {e}', 'success': False}))
        sys.exit(1)

    try:
        import wave
        with wave.open(args.output, 'wb') as wav_file:
            if hasattr(voice, 'synthesize_wav'):
                voice.synthesize_wav(args.text.strip(), wav_file)
            else:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)  # 16-bit PCM
                wav_file.setframerate(sample_rate)
                voice.synthesize(args.text.strip(), wav_file)
    except Exception as e:
        if os.path.exists(args.output):
            os.remove(args.output)
        print(json.dumps({'error': f'Synthesis failed: {e}', 'success': False}))
        sys.exit(1)

    elapsed = time.time() - start_t
    out_size = os.path.getsize(args.output) if os.path.exists(args.output) else 0

    if out_size < 100:
        print(json.dumps({'error': f'Output WAV is too small ({out_size} bytes)', 'success': False}))
        sys.exit(1)

    print(json.dumps({
        'success': True,
        'provider': 'piper',
        'sample_rate': sample_rate,
        'elapsed_ms': round(elapsed * 1000),
        'output_bytes': out_size,
        'model_path': args.model_path,
    }))

if __name__ == '__main__':
    main()
