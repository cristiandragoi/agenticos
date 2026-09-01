import sys
import asyncio
import argparse
import edge_tts

DEFAULT_VOICE = 'en-GB-RyanNeural'  # Natural British male English voice

async def synthesize(text: str, voice: str, output_path: str):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)

def main():
    parser = argparse.ArgumentParser(description='Local Neural TTS CLI')
    parser.add_argument('--text', type=str, required=True, help='Text to speak')
    parser.add_argument('--voice', type=str, default=DEFAULT_VOICE, help='Voice name')
    parser.add_argument('--output', type=str, required=True, help='Output audio file path')
    args = parser.parse_args()

    asyncio.run(synthesize(args.text, args.voice, args.output))
    print(f'TTS_OK:{args.output}')

if __name__ == '__main__':
    main()
