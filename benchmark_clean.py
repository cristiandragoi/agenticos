import os
import sys
import time
import json
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding='utf-8')

DE_AUDIO = os.path.abspath("docs/acceptance/audio/german_speech_sample.mp3")
RO_AUDIO = os.path.abspath("docs/acceptance/audio/romanian_speech_sample.mp3")

DE_GROUND_TRUTH = "Guten Morgen Jarvis, bitte erstelle einen neuen Arbeitsbereich."
RO_GROUND_TRUTH = "Bună dimineața Jarvis, te rog configurează noul proiect."

def levenshtein_similarity(s1, s2):
    s1, s2 = s1.lower().strip(), s2.lower().strip()
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    dp = [[0] * (len(s2) + 1) for _ in range(len(s1) + 1)]
    for i in range(len(s1) + 1):
        dp[i][0] = i
    for j in range(len(s2) + 1):
        dp[0][j] = j
    for i in range(1, len(s1) + 1):
        for j in range(1, len(s2) + 1):
            cost = 0 if s1[i-1] == s2[j-1] else 1
            dp[i][j] = min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost)
    max_len = max(len(s1), len(s2))
    return 1.0 - (dp[len(s1)][len(s2)] / max_len)

def get_dir_size_mb(path_dir):
    total = 0
    if not os.path.exists(path_dir):
        return 0
    for root, dirs, files in os.walk(path_dir):
        for f in files:
            fp = os.path.join(root, f)
            total += os.path.getsize(fp)
    return round(total / (1024 * 1024), 1)

def get_cache_size(model_name):
    hub_dir = os.path.expanduser(f"~/.cache/huggingface/hub/models--Systran--faster-whisper-{model_name}")
    return get_dir_size_mb(hub_dir)

def benchmark_model(model_name):
    disk_mb = get_cache_size(model_name)
    t0 = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    load_time = time.time() - t0
    
    # German
    t_de0 = time.time()
    de_segments, de_info = model.transcribe(DE_AUDIO, language="de")
    de_text = " ".join([s.text for s in de_segments]).strip()
    de_time = time.time() - t_de0
    de_sim = levenshtein_similarity(de_text, DE_GROUND_TRUTH)
    
    # Romanian
    t_ro0 = time.time()
    ro_segments, ro_info = model.transcribe(RO_AUDIO, language="ro")
    ro_text = " ".join([s.text for s in ro_segments]).strip()
    ro_time = time.time() - t_ro0
    ro_sim = levenshtein_similarity(ro_text, RO_GROUND_TRUTH)
    
    return {
        "model": model_name,
        "disk_size_mb": disk_mb,
        "load_time_sec": round(load_time, 2),
        "de": {
            "transcript": de_text,
            "duration_sec": round(de_time, 2),
            "similarity": round(de_sim, 3),
            "language_prob": round(de_info.language_probability, 3) if hasattr(de_info, 'language_probability') and de_info.language_probability is not None else None
        },
        "ro": {
            "transcript": ro_text,
            "duration_sec": round(ro_time, 2),
            "similarity": round(ro_sim, 3),
            "language_prob": round(ro_info.language_probability, 3) if hasattr(ro_info, 'language_probability') and ro_info.language_probability is not None else None
        }
    }

results = []
for m in ["tiny", "base", "small"]:
    try:
        res = benchmark_model(m)
        results.append(res)
    except Exception as e:
        print(f"Error {m}:", e)

print(json.dumps(results, indent=2, ensure_ascii=False))
