import { logger } from '../utils/logger.js';
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop } from '../services/agent/agentLoop.js';
import { mockAgents } from '../data.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GET /api/voice/tts/status - Safe diagnostics for renderer voice UI
router.get('/tts/status', async (_req, res) => {
  res.json({
    configured: Boolean(process.env.DEEPGRAM_API_KEY),
    provider: 'deepgram',
    endpoint: '/api/voice/tts'
  });
});

// POST /api/voice/transcribe - Transcribe audio using Deepgram
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No audio file provided.' });
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      return res.status(500).json({ error: 'Deepgram API key not configured.' });
    }

    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramKey}`,
        'Content-Type': file.mimetype || 'audio/webm',
      },
      body: file.buffer as unknown as BodyInit
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Voice] Deepgram Transcription error:', response.status, errorText);
      return res.status(502).json({ error: `Deepgram Transcription failed: ${response.status}` });
    }
    
    const data: any = await response.json();
    const text = data.results?.channels[0]?.alternatives[0]?.transcript || '';
    
    if (!text.trim()) {
      // Benign condition: the audio was valid but contained no speech.
      // Callers should treat this as a retriable notice, NOT a hard error.
      // The flag makes the condition machine-detectable without message parsing.
      return res.status(400).json({ error: 'No speech detected.', noSpeech: true });
    }

    return res.json({ text });
  } catch (error) {
    logger.error('[Voice] Transcription error:', error);
    return res.status(500).json({ error: 'Transcription failed.' });
  }
});

// POST /api/voice/speak - Generate speech from text using Deepgram TTS
router.post('/speak', async (req, res) => {
  try {
    const { text, voice, agentId } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      return res.status(500).json({ error: 'Deepgram API key not configured.' });
    }

    // PHASE 15 (Failure B — voice identity): the authoritative Jarvis voice is
    // aura-helios-en (matches the renderer's AGENT_VOICE default). A caller
    // that omits `voice` MUST NOT silently get a different voice
    // (aura-2-draco-en was the old server default — the mismatch caused
    // mid-session voice switching when a legacy path skipped the voice field).
    let defaultVoice = 'aura-orion-en';
    if (agentId === 'agent-jarvis') {
      defaultVoice = 'aura-helios-en';
    }
    const voiceModel = voice || defaultVoice;

    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voiceModel}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Voice] Deepgram TTS error:', response.status, errorText);
      return res.status(502).json({ error: `TTS failed: ${response.status}` });
    }

    const audioBuffer = await response.arrayBuffer();
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
    });
    res.send(Buffer.from(audioBuffer));
  } catch (error: any) {
    logger.error('[Voice] Speak error:', error);
    return res.status(500).json({ error: 'Text-to-speech failed.', details: error.message });
  }
});

// POST /api/voice/tts - Generate speech from text, returning base64-encoded audio JSON
router.post('/tts', async (req, res) => {
  try {
    const { text, voice, agentId } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      return res.status(500).json({ error: 'Deepgram API key not configured.' });
    }

    // PHASE 15 (Failure B — voice identity): agent-jarvis defaults to
    // aura-helios-en (matches the renderer). Never silently substitute a
    // different voice when the caller omits `voice`.
    let defaultVoice = 'aura-orion-en';
    if (agentId === 'agent-jarvis') {
      defaultVoice = 'aura-helios-en';
    }
    const voiceModel = voice || defaultVoice;

    const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voiceModel}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Voice] Deepgram TTS error:', response.status, errorText);
      return res.status(502).json({ error: `TTS failed: ${response.status}` });
    }

    const audioBuffer = await response.arrayBuffer();
    const audio = Buffer.from(audioBuffer);
    const wantsAudio = String(req.headers.accept || '').includes('audio/');

    if (wantsAudio) {
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audio.byteLength.toString(),
      });
      return res.send(audio);
    }

    const base64 = audio.toString('base64');
    
    res.json({
      success: true,
      text: text.trim(),
      audioData: base64,
      format: 'audio/mpeg',
      voice: voiceModel,
      sizeBytes: audio.byteLength,
    });
  } catch (error: any) {
    logger.error('[Voice] TTS error:', error);
    return res.status(500).json({ error: 'Text-to-speech failed.', details: error.message });
  }
});


// POST /api/voice/execute - Execute a text command through the Hermes agent loop
// This is what HermesDrawer calls when the user submits a command
router.post('/execute', async (req, res) => {
  try {
    const { text, agentId = 'agent-hermes' } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const agent = mockAgents.find(a => a.id === agentId);
    const agentName = agent?.name || 'Hermes';

    const systemPrompt = `You are ${agentName}, an AI agent in Agentic OS. You have access to tools that let you:
- Execute shell commands (terminal)
- Read and write files (read_file, write_file)
- Search files (search_files)
- Search the web (web_search)
- Extract web page content (web_extract)

You are helpful, knowledgeable, and direct. You execute tasks step by step.
When asked to do something, use your tools to accomplish it. Break complex tasks into steps.
Your working directory is the Agentic OS project root.
Keep responses concise and actionable. When you're done, explain what you did.

CRITICAL INSTRUCTION FOR VOICE/CHAT:
Treat all prompts as plain chat. Do NOT attempt to output direct XML/HTML function markup like "<function=terminal ...>". If you need to use a tool, use the standard JSON tool-calling format provided by the API.`;

    logger.info(`[Voice/Execute] ${agentName} received: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);

    const result = await runAgentLoop(systemPrompt, text.trim());

    return res.json({
      success: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      toolCalls: result.toolCalls,
    });
  } catch (err: any) {
    logger.error('[Voice/Execute] Error:', err.message);
    return res.status(500).json({
      error: 'Agent execution failed.',
      details: err.message,
    });
  }
});

export default router;
