import os
import time
from faster_whisper import WhisperModel

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

def benchmark_model(model_name):
    print(f"\n--- Testing Whisper Model: {model_name} ---")
    t0 = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    load_time = time.time() - t0
    
    # Benchmark German
    t_de0 = time.time()
    de_segments, de_info = model.transcribe(DE_AUDIO, language="de")
    de_text = " ".join([s.text for s in de_segments]).strip()
    de_time = time.time() - t_de0
    de_sim = levenshtein_similarity(de_text, DE_GROUND_TRUTH)
    
    # Benchmark Romanian
    t_ro0 = time.time()
    ro_segments, ro_info = model.transcribe(RO_AUDIO, language="ro")
    ro_text = " ".join([s.text for s in ro_segments]).strip()
    ro_time = time.time() - t_ro0
    ro_sim = levenshtein_similarity(ro_text, RO_GROUND_TRUTH)
    
    return {
        "model": model_name,
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

models = ["tiny", "base", "small"]
results = []
for m in models:
    try:
        res = benchmark_model(m)
        results.append(res)
        print(f"Result for {m}:", res)
    except Exception as e:
        print(f"Error testing {m}:", e)

import json
print("\n=== FINAL BENCHMARK RESULTS ===")
print(json.dumps(results, indent=2))
