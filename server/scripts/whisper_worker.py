import sys
import os
import json
import argparse
import warnings

# Suppress HF hub warnings on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
warnings.filterwarnings("ignore", category=UserWarning)

# Ensure nvidia DLLs can be found if installed in site-packages
try:
    import ctypes
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_roots = [
        sys.prefix,
        os.path.abspath(os.path.join(script_dir, '..', '.venv')),
        r"D:\AgenticOS\server\.venv"
    ]
    for root in candidate_roots:
        nvidia_dir = os.path.join(root, 'Lib', 'site-packages', 'nvidia')
        if os.path.isdir(nvidia_dir):
            for sub in os.listdir(nvidia_dir):
                bin_dir = os.path.join(nvidia_dir, sub, 'bin')
                if os.path.isdir(bin_dir):
                    try:
                        os.add_dll_directory(bin_dir)
                    except Exception:
                        pass
                    os.environ['PATH'] = bin_dir + ';' + os.environ.get('PATH', '')
                    for f in os.listdir(bin_dir):
                        if f.endswith('.dll'):
                            try:
                                ctypes.CDLL(os.path.join(bin_dir, f))
                            except Exception:
                                pass
except Exception as e:
    pass

def load_model(preferred_device="auto", model_size="base"):
    from faster_whisper import WhisperModel
    import ctranslate2

    device = "cpu"
    compute_type = "int8"

    if preferred_device in ["auto", "cuda"] and ctranslate2.get_cuda_device_count() > 0:
        try:
            m = WhisperModel(model_size, device="cuda", compute_type="float16")
            # Test encoding a tiny silent segment to verify DLLs (cublas/cudnn) load cleanly
            import numpy as np
            dummy_pcm = np.zeros(16000, dtype=np.float32)
            list(m.transcribe(dummy_pcm, beam_size=1)[0])
            return m, "cuda", "float16"
        except Exception as e:
            sys.stderr.write(f"[whisper_worker] CUDA init error ({e}), falling back to CPU\n")
            sys.stderr.flush()

    # CPU fallback
    m = WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=8)
    return m, "cpu", "int8"

def main():
    parser = argparse.ArgumentParser(description="Persistent Warm Whisper Worker")
    parser.add_argument("--model", type=str, default="base", help="Whisper model size")
    parser.add_argument("--device", type=str, default="auto", help="Preferred device (auto, cuda, cpu)")
    args = parser.parse_args()

    model_size = os.environ.get("WHISPER_MODEL", args.model)
    preferred_device = os.environ.get("WHISPER_DEVICE", args.device)

    try:
        model, device, compute_type = load_model(preferred_device, model_size)
    except Exception as e:
        sys.stdout.write(json.dumps({"status": "error", "error": str(e)}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    # Signal readiness
    sys.stdout.write(json.dumps({
        "status": "ready",
        "device": device,
        "compute_type": compute_type,
        "model": model_size
    }) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            audio_path = req.get("audioPath")
            language = req.get("language")

            if not audio_path or not os.path.exists(audio_path):
                sys.stdout.write(json.dumps({"error": f"File not found: {audio_path}"}) + "\n")
                sys.stdout.flush()
                continue

            # High-fidelity bilingual initial prompt covering key commands, entity names, and language switching
            initial_prompt = (
                "Hallo Jarvis, wie spät ist es, was kannst du tun, erzähl mir einen kurzen Witz, danke das reicht, "
                "Stopp, Halt, Abbrechen, Ruhe, Sprich ab jetzt Deutsch, bitte auf Deutsch, öffne Gmail, "
                "erstelle eine neue E-Mail, Schreibe an, cdinternationalproject@gmail.com, Betreff, Test AgenticOS, "
                "Öffne WhatsApp, WhatsApp, Telegram, YouTube, ChatGPT, Comet, Perplexity, AgenticOS, Free Cash, Shopify, "
                "stop, halt, cancel, quiet, shut up, be quiet, switch to English, what time is it, how are you."
            )

            transcribe_kwargs = {
                "beam_size": 1,
                "temperature": 0.0,
                "initial_prompt": initial_prompt
            }
            # Only force language if explicitly pinned to a non-English language (e.g. 'de' or 'ro').
            # If 'en', 'auto', or None, allow multilingual language identification to detect German/English dynamically.
            if language and language not in ["auto", "en"]:
                transcribe_kwargs["language"] = language

            segments, info = model.transcribe(audio_path, **transcribe_kwargs)

            segments_list = list(segments)
            text_parts = [segment.text.strip() for segment in segments_list]
            full_text = " ".join([p for p in text_parts if p]).strip()

            if segments_list:
                import math
                avg_logprob = sum(getattr(s, "avg_logprob", -0.5) for s in segments_list) / len(segments_list)
                max_no_speech = max(getattr(s, "no_speech_prob", 0.0) for s in segments_list)
                # Calibrate avg_logprob to realistic human speech confidence (avg_logprob -0.4 to -1.1 is typical confident speech)
                # Sigmoid centered at -1.1 with scale 2.5 maps:
                # -0.3 -> ~0.88, -0.6 -> ~0.78, -1.1 -> ~0.50, -1.8 -> ~0.15
                clamped_logprob = max(-5.0, min(0.0, avg_logprob))
                norm_conf = 1.0 / (1.0 + math.exp(-2.5 * (clamped_logprob + 1.1)))
                speech_confidence = round(norm_conf * (1.0 - max_no_speech), 4)
            else:
                speech_confidence = 0.0
                max_no_speech = 1.0
                avg_logprob = -99.0

            res_lang = getattr(info, "language", language or "en")
            res_prob = getattr(info, "language_probability", None)
            if res_prob is not None:
                try:
                    res_prob = round(float(res_prob), 4)
                except Exception:
                    res_prob = None

            sys.stdout.write(json.dumps({
                "text": full_text,
                "language": res_lang,
                "probability": res_prob,
                "confidence": speech_confidence,
                "noSpeechProb": max_no_speech,
                "avgLogprob": round(avg_logprob, 4),
                "effectiveModel": model_size,
                "device": device,
                "effectiveLanguage": language or res_lang
            }) + "\n")
            sys.stdout.flush()

        except Exception as err:
            sys.stdout.write(json.dumps({"error": str(err)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
