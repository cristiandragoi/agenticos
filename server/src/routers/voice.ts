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
      console.error('[Voice] Deepgram Transcription error:', response.status, errorText);
      return res.status(502).json({ error: `Deepgram Transcription failed: ${response.status}` });
    }
    
    const data: any = await response.json();
    const text = data.results?.channels[0]?.alternatives[0]?.transcript || '';
    
    if (!text.trim()) {
       return res.status(400).json({ error: 'No speech detected.' });
    }

    return res.json({ text });
  } catch (error) {
    console.error('[Voice] Transcription error:', error);
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

    let defaultVoice = 'aura-orion-en';
    if (agentId === 'agent-jarvis') {
      defaultVoice = 'aura-2-draco-en';
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
      console.error('[Voice] Deepgram TTS error:', response.status, errorText);
      return res.status(502).json({ error: `TTS failed: ${response.status}` });
    }

    const audioBuffer = await response.arrayBuffer();
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
    });
    res.send(Buffer.from(audioBuffer));
  } catch (error: any) {
    console.error('[Voice] Speak error:', error);
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

    let defaultVoice = 'aura-orion-en';
    if (agentId === 'agent-jarvis') {
      defaultVoice = 'aura-2-draco-en';
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
      console.error('[Voice] Deepgram TTS error:', response.status, errorText);
      return res.status(502).json({ error: `TTS failed: ${response.status}` });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString('base64');
    
    res.json({
      success: true,
      text: text.trim(),
      audioData: base64,
      format: 'audio/mpeg',
      voice: voiceModel,
      sizeBytes: audioBuffer.byteLength,
    });
  } catch (error: any) {
    console.error('[Voice] TTS error:', error);
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

    console.log(`[Voice/Execute] ${agentName} received: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);

    const result = await runAgentLoop(systemPrompt, text.trim());

    return res.json({
      success: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      toolCalls: result.toolCalls,
    });
  } catch (err: any) {
    console.error('[Voice/Execute] Error:', err.message);
    return res.status(500).json({
      error: 'Agent execution failed.',
      details: err.message,
    });
  }
});

export default router;

