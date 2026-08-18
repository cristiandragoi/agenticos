import { logger } from '../../../utils/logger.js';
/**
 * Speak Tool — allows the agent to respond with voice (TTS via Deepgram).
 * The agent calls this tool with the text it wants spoken aloud.
 * Returns base64-encoded audio data that the frontend can play.
 *
 * PHASE 15 (Failure B — voice identity): the Jarvis voice is pinned to
 * aura-helios-en (the authoritative renderer default). The old
 * aura-2-draco-en default for agent-jarvis was a DIFFERENT voice — a tool
 * reply that omitted `voice` silently switched Jarvis mid-session.
 */
export const speakTool = {
  name: 'speak',
  description: 'Reply to the user with spoken audio. Use this when you want to respond with voice instead of text. Call this with the exact text you want spoken aloud. The system will convert it to speech using Deepgram TTS.',
  parameters: [
    { name: 'text', type: 'string', description: 'The text to speak aloud to the user', required: true },
    { name: 'voice', type: 'string', description: 'Optional: Deepgram Aura voice model. Options: aura-2-draco-en (British male), aura-2-pandora-en (British female), aura-2-orion-en (American male), aura-2-asteria-en (American female), aura-2-helios-en (American deep male), aura-2-luna-en (American female). Default: aura-orion-en (American male)', required: false, enum: ['aura-2-draco-en', 'aura-2-pandora-en', 'aura-2-orion-en', 'aura-2-asteria-en', 'aura-2-helios-en', 'aura-2-luna-en'] },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const text = args.text as string;
    if (!text || !text.trim()) {
      return JSON.stringify({ error: 'No text provided to speak' });
    }

    let defaultVoice = 'aura-orion-en';
    if (args.agentId === 'agent-jarvis') {
      defaultVoice = 'aura-helios-en';
    }
    const voice = (args.voice as string) || defaultVoice;
    const deepgramKey = process.env.DEEPGRAM_API_KEY;

    if (!deepgramKey) {
      // No Deepgram key — return the text so the frontend can use browser TTS
      return JSON.stringify({
        success: true,
        text: text.trim(),
        audioData: null,
        note: 'No DEEPGRAM_API_KEY configured. Frontend should use browser SpeechSynthesis as fallback.',
      });
    }

    try {
      logger.info(`[SpeakTool] TTS: Deepgram ${voice} — "${text.slice(0, 60)}..."`);
      const ttsResponse = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.trim() }),
        signal: AbortSignal.timeout(30000),
      });

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text();
        logger.warn(`[SpeakTool] Deepgram TTS failed (${ttsResponse.status}): ${errText}`);
        return JSON.stringify({
          success: true,
          text: text.trim(),
          audioData: null,
          note: `TTS failed (HTTP ${ttsResponse.status}). Frontend should use browser SpeechSynthesis.`,
        });
      }

      const buffer = await ttsResponse.arrayBuffer();
      const audioData = Buffer.from(buffer).toString('base64');
      logger.info(`[SpeakTool] TTS generated: ${buffer.byteLength} bytes`);

      return JSON.stringify({
        success: true,
        text: text.trim(),
        audioData,
        format: 'audio/mpeg',
        voice,
        sizeBytes: buffer.byteLength,
      });
    } catch (err: any) {
      logger.warn('[SpeakTool] Deepgram TTS connection error:', err);
      return JSON.stringify({
        success: true,
        text: text.trim(),
        audioData: null,
        note: `TTS connection error: ${err.message}. Frontend should use browser SpeechSynthesis.`,
      });
    }
  },
};
