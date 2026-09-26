import sys
import asyncio
import argparse
import edge_tts

DEFAULT_VOICE = 'en-GB-RyanNeural'  # Natural British male English voice

VOICE_MAP = {
    'aura-orion-en': 'en-US-GuyNeural',
    'aura-zeus-en': 'en-US-ChristopherNeural',
    'aura-helios-en': 'en-GB-RyanNeural',
    'aura-athena-en': 'en-US-AriaNeural',
    'aura-arcas-en': 'en-US-BrianNeural',
    'aura-luna-en': 'en-US-JennyNeural',
    'aura-stella-en': 'en-US-EmmaNeural',
    'aura-orpheus-en': 'en-US-AndrewNeural',
    'aura-angus-en': 'en-IE-ConnorNeural',
    'orion': 'en-US-GuyNeural',
    'zeus': 'en-US-ChristopherNeural',
    'helios': 'en-GB-RyanNeural',
    'athena': 'en-US-AriaNeural',
}

async def synthesize(text: str, voice: str, output_path: str, rate: str = None, pitch: str = None):
    kwargs = {}
    if rate:
        kwargs['rate'] = rate
    if pitch:
        kwargs['pitch'] = pitch
    resolved_voice = VOICE_MAP.get((voice or '').lower().strip(), voice) if voice else DEFAULT_VOICE
    if not resolved_voice or not resolved_voice.endswith('Neural'):
        resolved_voice = DEFAULT_VOICE
    communicate = edge_tts.Communicate(text, resolved_voice, **kwargs)
    await communicate.save(output_path)

def main():
    parser = argparse.ArgumentParser(description='Local Neural TTS CLI')
    parser.add_argument('--text', type=str, required=True, help='Text to speak')
    parser.add_argument('--voice', type=str, default=DEFAULT_VOICE, help='Voice name')
    parser.add_argument('--output', type=str, required=True, help='Output audio file path')
    parser.add_argument('--rate', type=str, default=None, help='Speaking rate adjustment')
    parser.add_argument('--pitch', type=str, default=None, help='Pitch adjustment')
    args = parser.parse_args()

    asyncio.run(synthesize(args.text, args.voice, args.output, rate=args.rate, pitch=args.pitch))
    print(f'TTS_OK:{args.output}')

if __name__ == '__main__':
    main()
