import sys
import os
import json
import argparse
import warnings

# Suppress HF hub warnings on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
warnings.filterwarnings("ignore", category=UserWarning)

def main():
    parser = argparse.ArgumentParser(description="Local Whisper Transcriber")
    parser.add_argument("audio_path", type=str, help="Path to audio file")
    parser.add_argument("--language", type=str, default=None, help="Target language code (e.g. de, ro, en, auto)")
    args = parser.parse_args()

    audio_path = args.audio_path
    if not os.path.exists(audio_path):
        print(json.dumps({'error': f'Audio file not found: {audio_path}'}))
        sys.exit(1)
        
    try:
        from faster_whisper import WhisperModel
        
        # If language is non-English, auto, or unspecified, use multilingual model; if explicitly English, tiny.en is fine
        is_explicit_english = args.language in ['en', 'en-US', 'en-GB', 'en-AU']
        default_model = 'tiny.en' if is_explicit_english else 'tiny'
        model_size = os.environ.get('WHISPER_MODEL', default_model)
        
        # Run on CPU with int8 quantization for fast low-latency execution
        model = WhisperModel(model_size, device='cpu', compute_type='int8')
        
        transcribe_kwargs = {'beam_size': 1, 'temperature': 0.0}
        if args.language and args.language != 'auto':
            transcribe_kwargs['language'] = args.language
            
        segments, info = model.transcribe(audio_path, **transcribe_kwargs)
        text_parts = [segment.text.strip() for segment in segments]
        full_text = ' '.join([p for p in text_parts if p]).strip()
        
        res_lang = getattr(info, 'language', args.language or 'en')
        res_prob = getattr(info, 'language_probability', None)
        if res_prob is not None:
            try:
                res_prob = round(float(res_prob), 4)
            except Exception:
                res_prob = None

        
        print(json.dumps({
            'text': full_text,
            'language': res_lang,
            'probability': res_prob,
            'effectiveModel': model_size,
            'effectiveLanguage': args.language or res_lang
        }))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
