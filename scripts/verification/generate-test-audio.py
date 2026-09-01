import os
import sys
import asyncio
import hashlib
import edge_tts

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "acceptance", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

async def generate_speech(text, voice, out_path):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)

def compute_sha256(file_path):
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

async def main():
    de_path = os.path.join(AUDIO_DIR, "german_speech_sample.mp3")
    ro_path = os.path.join(AUDIO_DIR, "romanian_speech_sample.mp3")

    print("[AudioGen] Generating German audio sample...")
    await generate_speech("Guten Morgen Jarvis, bitte erstelle einen neuen Arbeitsbereich.", "de-DE-KillianNeural", de_path)
    
    print("[AudioGen] Generating Romanian audio sample...")
    await generate_speech("Bună dimineața Jarvis, te rog configurează noul proiect.", "ro-RO-EmilNeural", ro_path)

    print(f"[AudioGen] DE Sample: {de_path} | Size: {os.path.getsize(de_path)} bytes | SHA256: {compute_sha256(de_path)}")
    print(f"[AudioGen] RO Sample: {ro_path} | Size: {os.path.getsize(ro_path)} bytes | SHA256: {compute_sha256(ro_path)}")

if __name__ == "__main__":
    asyncio.run(main())
