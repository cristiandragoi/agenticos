"""
Download Piper TTS models for AgenticOS.
Idempotent: skips download if valid file already exists.
"""
import sys
import os
import hashlib
import urllib.request
import json

MODELS = {
    'de_DE-thorsten-high': {
        'onnx_url': 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx',
        'json_url': 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json',
        'onnx_sha256': '9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1',
        'min_onnx_size': 50_000_000,  # at least 50MB
    },
    'ro_RO-mihai-medium': {
        'onnx_url': 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx',
        'json_url': 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx.json',
        'onnx_sha256': 'e0608bbbd53c80267c09ece681b09f5199f54e792356684c8073738e5f15d29f',
        'min_onnx_size': 30_000_000,  # at least 30MB
    },
}

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'piper')

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

def download_file(url, dest):
    print(f'  Downloading {os.path.basename(dest)} from {url}...', flush=True)
    headers = {
        'User-Agent': 'AgenticOS-ModelDownloader/1.0'
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            total = int(resp.headers.get('Content-Length', 0))
            downloaded = 0
            with open(dest, 'wb') as f:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded * 100 // total
                        print(f'  {pct}% ({downloaded // 1_000_000}MB / {total // 1_000_000}MB)\r', end='', flush=True)
        print(f'  Done: {downloaded // 1_000_000}MB', flush=True)
    except Exception as e:
        if os.path.exists(dest):
            os.remove(dest)
        raise RuntimeError(f'Download failed for {url}: {e}')

def ensure_model(voice_key, config):
    model_dir = os.path.join(BASE_DIR, voice_key)
    os.makedirs(model_dir, exist_ok=True)

    onnx_path = os.path.join(model_dir, f'{voice_key}.onnx')
    json_path = os.path.join(model_dir, f'{voice_key}.onnx.json')

    # Check if ONNX already valid
    onnx_ok = False
    if os.path.exists(onnx_path):
        size = os.path.getsize(onnx_path)
        if size >= config['min_onnx_size']:
            digest = sha256_file(onnx_path)
            if digest == config['onnx_sha256']:
                print(f'[{voice_key}] ONNX already valid (SHA256 match, {size // 1_000_000}MB). Skipping download.')
                onnx_ok = True
            else:
                print(f'[{voice_key}] ONNX exists but SHA256 mismatch (got {digest[:16]}...), re-downloading.')
                os.remove(onnx_path)
        else:
            print(f'[{voice_key}] ONNX exists but too small ({size} bytes), re-downloading.')
            os.remove(onnx_path)

    if not onnx_ok:
        print(f'[{voice_key}] Downloading ONNX model...')
        download_file(config['onnx_url'], onnx_path)
        # Verify
        digest = sha256_file(onnx_path)
        if digest != config['onnx_sha256']:
            os.remove(onnx_path)
            raise RuntimeError(f'[{voice_key}] SHA256 mismatch after download! Expected {config["onnx_sha256"]}, got {digest}')
        print(f'[{voice_key}] ONNX SHA256 verified: {digest[:16]}...')

    # JSON config
    if not os.path.exists(json_path) or os.path.getsize(json_path) < 100:
        print(f'[{voice_key}] Downloading JSON config...')
        download_file(config['json_url'], json_path)
    else:
        print(f'[{voice_key}] JSON config already present.')

    # Validate JSON
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        print(f'[{voice_key}] JSON valid. Sample rate: {cfg.get("audio", {}).get("sample_rate", "?")} Hz')
    except Exception as e:
        raise RuntimeError(f'[{voice_key}] JSON config invalid: {e}')

    return onnx_path, json_path

if __name__ == '__main__':
    errors = []
    for voice_key, config in MODELS.items():
        print(f'\n=== {voice_key} ===')
        try:
            onnx_path, json_path = ensure_model(voice_key, config)
            print(f'[{voice_key}] OK: {onnx_path}')
        except Exception as e:
            print(f'[{voice_key}] FAILED: {e}', file=sys.stderr)
            errors.append(f'{voice_key}: {e}')

    if errors:
        print(f'\nErrors: {len(errors)}', file=sys.stderr)
        for e in errors:
            print(f'  {e}', file=sys.stderr)
        sys.exit(1)
    else:
        print('\nAll models ready.')
        sys.exit(0)
