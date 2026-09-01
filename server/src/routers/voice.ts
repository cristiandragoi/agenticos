import { sanitizeMarkdownForSpeech } from '../utils/speechSanitizer.js';
import { logger } from '../utils/logger.js';
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop } from '../services/agent/agentLoop.js';
import { mockAgents } from '../data.js';
import { transcribeLocally } from '../services/voice/localTranscribe.js';
import {
  synthesizeLocally,
  resolveVoiceForLanguage,
  resolveLocaleForLanguage,
  verifySpeechSynthesisAvailability,
  resolvePythonExecutable,
  DEFAULT_NEURAL_VOICE,
} from '../services/voice/localTts.js';
import {
  synthesizeWithPiper,
  hasPiperVoiceForLanguage,
  LANGUAGE_TO_PIPER_VOICE,
} from '../services/voice/piperTts.js';
import {
  detectTextLanguage,
  getConversationLanguage,
  setConversationLanguage,
  isSubstantiveLanguageDetection,
} from '../domains/jarvis/conversationLanguage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GET /api/voice/tts/status - Authoritative diagnostics for renderer voice UI
router.get('/tts/status', async (req, res) => {
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const conversationId = (req.query.conversationId as string) || (req.query.conversation_id as string) || undefined;
  const explicitLang = (req.query.language as string) || undefined;

  let activeLang = explicitLang;
  if (!activeLang && conversationId) {
    activeLang = getConversationLanguage(conversationId);
  }
  activeLang = activeLang || 'en';

  const requestedLocale = resolveLocaleForLanguage(activeLang);
  const effectiveVoice = resolveVoiceForLanguage(activeLang, req.query.voice as string);
  const useDeepgram = Boolean(deepgramKey && activeLang === 'en');
  const effectiveProvider = useDeepgram ? 'deepgram' : 'edge-tts';

  let availability = true;
  let fallbackReason: string | null = null;

  if (activeLang !== 'en' || !useDeepgram) {
    const probe = await verifySpeechSynthesisAvailability(effectiveVoice);
    if (!probe.available) {
      availability = false;
      fallbackReason = probe.error || `Voice synthesis unavailable for ${effectiveVoice}`;
    }
  }

  res.json({
    configured: Boolean(deepgramKey ? true : availability),
    activeLanguage: activeLang,
    requestedLocale,
    effectiveProvider,
    effectiveVoice,
    availability,
    speechAvailable: availability,
    fallbackReason,
    endpoint: '/api/voice/tts',
    locale: requestedLocale,
    jarvisVoice: effectiveVoice,
    engine: effectiveProvider,
    interpreter: resolvePythonExecutable(),
    supportedLanguages: ['en', 'de', 'ro'],
  });
});

// POST /api/voice/transcribe - Transcribe audio using Deepgram with Local Whisper fallback
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No audio file provided.' });
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    const conversationId = (req.query.conversationId as string) || (req.body?.conversationId as string) || undefined;
    let reqLang = (req.query.language as string) || (req.body?.language as string) || undefined;

    if (!reqLang && conversationId) {
      reqLang = getConversationLanguage(conversationId);
    }
    if (reqLang === 'auto') {
      reqLang = undefined;
    }

    if (deepgramKey) {
      const dgLang = reqLang === 'de' ? 'de' : reqLang === 'ro' ? 'ro' : (reqLang || 'en-GB');
      let response: Response;
      try {
        response = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=${dgLang}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${deepgramKey}`,
            'Content-Type': file.mimetype || 'audio/webm',
          },
          body: file.buffer as unknown as BodyInit,
        });
      } catch (networkErr: any) {
        // Network failure talking to Deepgram — attempt local Whisper before giving up
        try {
          const localResult = await transcribeLocally(file.buffer, file.originalname || '.webm', reqLang);
          if (!localResult.text || !localResult.text.trim()) {
            return res.status(400).json({ error: 'No speech detected.', noSpeech: true });
          }
          const detLang = (localResult.language || '').toLowerCase().slice(0, 2);
          if (conversationId && (detLang === 'de' || detLang === 'ro' || detLang === 'en')) {
            if (isSubstantiveLanguageDetection(localResult.text, detLang, localResult.probability)) {
              setConversationLanguage(conversationId, detLang as any);
              logger.info(`[Voice:Transcribe] Auto-switched conversation ${conversationId} language to ${detLang} (text="${localResult.text.slice(0, 40)}")`);
            }
          }
          return res.json({
            text: localResult.text,
            provider: 'local-whisper',
            model: localResult.effectiveModel,
            language: localResult.language,
            probability: localResult.probability !== undefined ? localResult.probability : null,
          });
        } catch {
          return res.status(502).json({ error: `Deepgram upstream network failure: ${networkErr.message}` });
        }
      }

      if (response.status === 401) {
        return res.status(502).json({ error: 'Deepgram upstream authentication failed (401).' });
      }

      if (!response.ok) {
        try {
          const localResult = await transcribeLocally(file.buffer, file.originalname || '.webm', reqLang);
          if (!localResult.text || !localResult.text.trim()) {
            return res.status(400).json({ error: 'No speech detected.', noSpeech: true });
          }
          const detLang = (localResult.language || '').toLowerCase().slice(0, 2);
          if (conversationId && (detLang === 'de' || detLang === 'ro' || detLang === 'en')) {
            if (isSubstantiveLanguageDetection(localResult.text, detLang, localResult.probability)) {
              setConversationLanguage(conversationId, detLang as any);
              logger.info(`[Voice:Transcribe] Auto-switched conversation ${conversationId} language to ${detLang} (text="${localResult.text.slice(0, 40)}")`);
            }
          }
          return res.json({
            text: localResult.text,
            provider: 'local-whisper',
            model: localResult.effectiveModel,
            language: localResult.language,
            probability: localResult.probability !== undefined ? localResult.probability : null,
          });
        } catch {
          return res.status(502).json({ error: `Deepgram upstream error (${response.status})` });
        }
      }

      const data: any = await response.json();
      const text = data.results?.channels[0]?.alternatives[0]?.transcript || '';

      if (!text.trim()) {
        return res.status(400).json({ error: 'No speech detected.', noSpeech: true });
      }

      const detLang = (dgLang || '').toLowerCase().slice(0, 2);
      if (conversationId && (detLang === 'de' || detLang === 'ro' || detLang === 'en')) {
        if (isSubstantiveLanguageDetection(text, detLang)) {
          setConversationLanguage(conversationId, detLang as any);
        }
      }

      return res.json({
        text,
        provider: 'deepgram',
        model: 'nova-2',
        language: dgLang,
        probability: null,
      });
    }

    // No Deepgram key configured: Attempt local Whisper
    try {
      const localResult = await transcribeLocally(file.buffer, file.originalname || '.webm', reqLang);
      if (!localResult.text || !localResult.text.trim()) {
        return res.status(400).json({ error: 'No speech detected.', noSpeech: true });
      }
      const detLang = (localResult.language || '').toLowerCase().slice(0, 2);
      if (conversationId && (detLang === 'de' || detLang === 'ro' || detLang === 'en')) {
        if (isSubstantiveLanguageDetection(localResult.text, detLang, localResult.probability)) {
          setConversationLanguage(conversationId, detLang as any);
          logger.info(`[Voice:Transcribe] Auto-switched conversation ${conversationId} language to ${detLang} (text="${localResult.text.slice(0, 40)}")`);
        }
      }
      return res.json({
        text: localResult.text,
        provider: 'local-whisper',
        model: localResult.effectiveModel,
        language: localResult.language,
        probability: localResult.probability !== undefined ? localResult.probability : null,
      });

    } catch (localErr: any) {
      logger.error('[Voice] Local transcription failed:', localErr);
      return res.status(500).json({ error: `Transcription failed: ${localErr?.message || 'Local Whisper failed'}` });
    }
  } catch (error: any) {
    logger.error('[Voice] Transcription error:', error);
    return res.status(500).json({ error: 'Transcription failed.' });
  }
});

// POST /api/voice/speak - Generate speech from text using Local Neural TTS (with Deepgram if key set)
router.post('/speak', async (req, res) => {
  try {
    const { text, voice, agentId, conversationId } = req.body;
    let language = req.body.language;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    if (!language && conversationId) {
      language = getConversationLanguage(conversationId);
    }

    const cleanText = sanitizeMarkdownForSpeech(text) || text;
    const detectedLang = language || detectTextLanguage(cleanText) || 'en';
    let audio: Buffer | null = null;

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (deepgramKey && detectedLang === 'en') {
      let defaultVoice = 'aura-orion-en';
      if (agentId === 'agent-jarvis') {
        defaultVoice = 'aura-helios-en';
      }
      const voiceModel = voice || defaultVoice;

      try {
        const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voiceModel}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${deepgramKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: cleanText }),
        });

        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();
          audio = Buffer.from(audioBuffer);
        }
      } catch (dgErr) {
        logger.warn('[Voice] Deepgram speak failed, falling back to local neural TTS', dgErr);
      }
    }

    if (!audio) {
      try {
        const resolvedVoice = resolveVoiceForLanguage(detectedLang, voice);
        audio = await synthesizeLocally(cleanText, resolvedVoice);
      } catch (localErr: any) {
        logger.error('[Voice] Local Neural TTS error:', localErr);
        return res.status(500).json({ error: 'Text-to-speech failed.', details: localErr.message, speechAvailable: false });
      }
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.byteLength.toString(),
    });
    res.send(audio);
  } catch (error: any) {
    logger.error('[Voice] Speak error:', error);
    return res.status(500).json({ error: 'Text-to-speech failed.', details: error.message, speechAvailable: false });
  }
});

// POST /api/voice/tts - Generate speech from text, returning base64-encoded audio JSON or binary
router.post('/tts', async (req, res) => {
  try {
    const { text, voice, agentId, conversationId } = req.body;
    let language = req.body.language;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    if (!language && conversationId) {
      language = getConversationLanguage(conversationId);
    }

    const cleanText = sanitizeMarkdownForSpeech(text) || text;
    const detectedLang = (language || detectTextLanguage(cleanText) || 'en').toLowerCase().trim().slice(0, 2);
    let audio: Buffer | null = null;
    let usedVoice = resolveVoiceForLanguage(detectedLang, voice);
    let usedProvider = 'edge-tts';
    let usedFormat: 'audio/mpeg' | 'audio/wav' = 'audio/mpeg';
    let fallbackReason: string | undefined;

    // ── PIPER primary for de/ro ────────────────────────────────────────────
    if ((detectedLang === 'de' || detectedLang === 'ro') && hasPiperVoiceForLanguage(detectedLang)) {
      const piperVoiceKey = LANGUAGE_TO_PIPER_VOICE[detectedLang];
      try {
        const piperResult = await synthesizeWithPiper(cleanText, detectedLang, piperVoiceKey);
        audio = piperResult.audio;
        usedVoice = piperResult.voice;
        usedProvider = 'piper';
        usedFormat = 'audio/wav';
        logger.info('[Voice/TTS] Piper synthesis OK', { lang: detectedLang, voice: usedVoice, bytes: audio.length });
      } catch (piperErr: any) {
        fallbackReason = `Piper failed: ${piperErr.message}`;
        logger.warn('[Voice/TTS] Piper failed, falling back to edge-tts', { lang: detectedLang, error: piperErr.message });
      }
    }

    // ── DEEPGRAM for English (if key present) ─────────────────────────────
    if (!audio) {
      const deepgramKey = process.env.DEEPGRAM_API_KEY;
      if (deepgramKey && detectedLang === 'en') {
        let defaultVoice = 'aura-orion-en';
        if (agentId === 'agent-jarvis') {
          defaultVoice = 'aura-helios-en';
        }
        usedVoice = (voice && voice.startsWith('aura-')) ? voice : defaultVoice;

        try {
          const response = await fetch(`https://api.deepgram.com/v1/speak?model=${usedVoice}`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${deepgramKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: cleanText }),
          });

          if (response.ok) {
            const audioBuffer = await response.arrayBuffer();
            audio = Buffer.from(audioBuffer);
            usedProvider = 'deepgram';
            usedFormat = 'audio/mpeg';
          }
        } catch (dgErr) {
          logger.warn('[Voice] Deepgram TTS failed, falling back to local neural TTS', dgErr);
        }
      }
    }

    // ── EDGE-TTS fallback ─────────────────────────────────────────────────
    if (!audio) {
      try {
        usedVoice = resolveVoiceForLanguage(detectedLang, voice);
        audio = await synthesizeLocally(cleanText, usedVoice);
        usedProvider = 'edge-tts';
        usedFormat = 'audio/mpeg';
        if (fallbackReason) {
          logger.info('[Voice/TTS] edge-tts fallback used', { voice: usedVoice, reason: fallbackReason });
        }
      } catch (localErr: any) {
        logger.error('[Voice] Local Neural TTS error:', localErr);
        return res.status(200).json({
          success: false,
          text: text.trim(),
          speechAvailable: false,
          language: detectedLang,
          error: `Text-to-speech voice unavailable for language ${detectedLang}: ${localErr.message}`,
        });
      }
    }

    const wantsAudio = String(req.headers.accept || '').includes('audio/');

    if (wantsAudio) {
      res.set({
        'Content-Type': usedFormat,
        'Content-Length': audio!.byteLength.toString(),
      });
      return res.send(audio);
    }

    const base64 = audio!.toString('base64');

    res.json({
      success: true,
      text: text.trim(),
      audioData: base64,
      format: usedFormat,
      voice: usedVoice,
      provider: usedProvider,
      language: detectedLang,
      speechAvailable: true,
      sizeBytes: audio!.byteLength,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  } catch (error: any) {
    logger.error('[Voice] TTS error:', error);
    return res.status(500).json({ error: 'Text-to-speech failed.', details: error.message, speechAvailable: false });
  }
});

// POST /api/voice/execute - Execute a text command through the Hermes agent loop
router.post('/execute', async (req, res) => {
  try {
    const { text, agentId = 'agent-hermes' } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const agent = mockAgents.find((a) => a.id === agentId);
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
