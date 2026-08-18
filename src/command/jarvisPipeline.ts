import { apiClient, apiFetch } from '../api/client';

export type StageId =
  | 'input'
  | 'job_discovery'
  | 'welders_researcher'
  | 'email_copywriter'
  | 'sentinel'
  | 'video_agent'
  | 'review_qa'
  | 'deploy_output'
  | 'jarvis_voice_reply'
  | 'qwythos'
  | 'code_generation'
  | 'preview_build'
  | 'save_workspace';

export type StageStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface StageConfig {
  stageId: StageId;
  label: string;
  agentId: string;
  providerId: string;
  actionType: string;
  description: string;
  color: string;
}

export const STAGE_CONFIG: Record<StageId, StageConfig> = {
  input: {
    stageId: 'input',
    label: 'Input / Commands',
    agentId: 'Jarvis',
    providerId: 'ornith',
    actionType: 'input',
    description: 'Voice or text command ingestion',
    color: '#38bdf8',
  },
  job_discovery: {
    stageId: 'job_discovery',
    label: 'SCOUT',
    agentId: 'SCOUT',
    providerId: 'ornith',
    actionType: 'job_discovery',
    description: 'Discover markets, leads, and targets',
    color: '#10b981',
  },
  welders_researcher: {
    stageId: 'welders_researcher',
    label: 'Welders Researcher',
    agentId: 'Welders Researcher',
    providerId: 'ornith',
    actionType: 'market_research',
    description: 'DE/NL welders market research',
    color: '#8b5cf6',
  },
  email_copywriter: {
    stageId: 'email_copywriter',
    label: 'Email Copywriter',
    agentId: 'Email Copywriter',
    providerId: 'ornith',
    actionType: 'email_template',
    description: 'Generate email templates and sequences',
    color: '#a78bfa',
  },
  sentinel: {
    stageId: 'sentinel',
    label: 'Sentinel / Logging',
    agentId: 'Sentinel',
    providerId: 'ornith',
    actionType: 'logging',
    description: 'Monitor execution and perform system logging',
    color: '#ef4444',
  },
  video_agent: {
    stageId: 'video_agent',
    label: 'VideoAgent',
    agentId: 'VideoAgent',
    providerId: 'ornith',
    actionType: 'video_pipeline',
    description: 'Plan and script video content',
    color: '#22c55e',
  },
  review_qa: {
    stageId: 'review_qa',
    label: 'Review / QA',
    agentId: 'Review / QA',
    providerId: 'ornith',
    actionType: 'review',
    description: 'Code and content quality assurance',
    color: '#f59e0b',
  },
  deploy_output: {
    stageId: 'deploy_output',
    label: 'Fusion',
    agentId: 'Fusion',
    providerId: 'ornith',
    actionType: 'deploy_output',
    description: 'Finalize and push outputs (vault, channels)',
    color: '#06b6d4',
  },
  jarvis_voice_reply: {
    stageId: 'jarvis_voice_reply',
    label: 'Voice Reply',
    agentId: 'Jarvis',
    providerId: 'ornith',
    actionType: 'tts',
    description: 'Local Text-to-Speech audio generation',
    color: '#ec4899',
  },
  qwythos: {
    stageId: 'qwythos',
    label: 'Qwythos 9B',
    agentId: 'agent-qwythos',
    providerId: 'ollama',
    actionType: 'local_reasoning',
    description: 'Qwythos 9B Abliterated — local reasoning via Ollama on port 11434.',
    color: '#a78bfa',
  },
  code_generation: {
    stageId: 'code_generation',
    label: 'Qwable Coder',
    agentId: 'agent-qwable',
    providerId: 'prov-qwable',
    actionType: 'code_generation',
    description: 'Local code generation using Qwable 27B model.',
    color: '#3b82f6',
  },
  preview_build: {
    stageId: 'preview_build',
    label: 'Build Preview',
    agentId: 'agent-qwable',
    providerId: 'prov-qwable',
    actionType: 'preview_build',
    description: 'Live preview compilation of generated layout.',
    color: '#10b981',
  },
  save_workspace: {
    stageId: 'save_workspace',
    label: 'Save Workspace',
    agentId: 'agent-qwable',
    providerId: 'prov-qwable',
    actionType: 'workspace_saving',
    description: 'Save output code files to the active workspace.',
    color: '#f59e0b',
  },
};

export interface StageLogEntry {
  id: string;
  stageId: StageId;
  status: StageStatus;
  commandText: string;
  summary?: string;
  audioUrl?: string;
  createdAt: string;
}

export interface PipelineState {
  stageStatuses: Record<StageId, StageStatus>;
  stageLogs: StageLogEntry[];
}

// Global state
let pipelineState: PipelineState = {
  stageStatuses: {
    input: 'idle',
    job_discovery: 'idle',
    welders_researcher: 'idle',
    email_copywriter: 'idle',
    sentinel: 'idle',
    video_agent: 'idle',
    review_qa: 'idle',
    deploy_output: 'idle',
    jarvis_voice_reply: 'idle',
    qwythos: 'idle',
    code_generation: 'idle',
    preview_build: 'idle',
    save_workspace: 'idle',
  },
  stageLogs: [],
};

type Listener = () => void;
const listeners: Listener[] = [];

export function subscribe(listener: Listener) {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx > -1) listeners.splice(idx, 1);
  };
}

function notify() {
  listeners.forEach((l) => l());
}

export function getPipelineState() {
  return pipelineState;
}

export function updateStageStatus(stageId: StageId, status: StageStatus) {
  pipelineState = {
    ...pipelineState,
    stageStatuses: {
      ...pipelineState.stageStatuses,
      [stageId]: status,
    },
  };
  notify();
}

export function appendLog(entry: Omit<StageLogEntry, 'id' | 'createdAt'>) {
  pipelineState = {
    ...pipelineState,
    stageLogs: [
      {
        ...entry,
        id: Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString(),
      },
      ...pipelineState.stageLogs,
    ],
  };
  notify();
}

const ORNITH_SERVER_URL = 'http://localhost:11434/api/chat';
const ORNITH_MODEL_NAME = 'qwythos:9b'; // User's requested model

export async function runStage(
  stageId: StageId,
  commandText: string,
  opts?: { viaHermes?: boolean; isTTS?: boolean }
): Promise<{ ok: boolean; summary?: string }> {
  updateStageStatus(stageId, 'running');
  appendLog({
    stageId,
    status: 'running',
    commandText,
    summary: opts?.isTTS ? 'Generating voice reply...' : `Initializing stage: ${STAGE_CONFIG[stageId].label}...`
  });

  const isQwableStage = stageId === 'code_generation' || stageId === 'preview_build' || stageId === 'save_workspace';
  if (isQwableStage) {
    try {
      const res = await apiFetch('/api/agentic/pipelines/qwable-build-pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: commandText, stageId })
      });
      if (!res.ok) throw new Error(`Backend Pipeline Run Failed: ${res.status}`);
      const data = await res.json();
      if (data.testResult === 'failed') throw new Error(data.error || 'Pipeline run failed');
      
      const reply = `Qwable completed ${STAGE_CONFIG[stageId].label}: ${data.message}`;
      updateStageStatus(stageId, 'completed');
      appendLog({ stageId, status: 'completed', commandText, summary: reply });
      return { ok: true, summary: reply };
    } catch (err: any) {
      updateStageStatus(stageId, 'failed');
      appendLog({ stageId, status: 'failed', commandText, summary: err.message || 'Unknown error occurred.' });
      return { ok: false };
    }
  }

  try {
    if (opts?.isTTS) {
      // Local TTS Logic via backend proxy
      const cleanText = commandText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/#{1,6}\s/g, '').replace(/`{1,3}[^`]*`{1,3}/g, '');
      const res = await apiFetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // PHASE 15 (Failure B): Jarvis voice pinned to aura-helios-en — was
        // aura-orion-en (Hermes' voice), a silent voice switch on this path.
        body: JSON.stringify({ text: cleanText, voice: 'aura-helios-en' })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`TTS Failed: ${res.status} ${errText}`);
      }
      
      const blob = await res.blob();
      if (blob.size === 0) {
        throw new Error('TTS returned empty audio');
      }
      const audioUrl = URL.createObjectURL(blob);

      return new Promise((resolve) => {
        const audio = new Audio(audioUrl);
        
        audio.onplay = () => {
          updateStageStatus(stageId, 'completed');
          appendLog({
            stageId,
            status: 'completed',
            commandText,
            summary: 'Voice playback success: aura-orion-en'
          });
          resolve({ ok: true, summary: 'Voice playback success: aura-orion-en' });
        };
        
        audio.onerror = () => {
          const errMessage = audio.error?.message || 'Playback decoding error';
          updateStageStatus(stageId, 'failed');
          appendLog({
            stageId,
            status: 'failed',
            commandText,
            summary: `Jarvis voice failed: ${errMessage}`
          });
          resolve({ ok: false, summary: `Jarvis voice failed: ${errMessage}` });
        };

        audio.play().catch((err) => {
          const errMsg = err.message || 'Autoplay blocked';
          updateStageStatus(stageId, 'failed');
          appendLog({
            stageId,
            status: 'failed',
            commandText,
            summary: `Jarvis voice failed: ${errMsg}`
          });
          resolve({ ok: false, summary: `Jarvis voice failed: ${errMsg}` });
        });
      });
    }

    if (opts?.viaHermes) {
      // Direct Ollama call — bypasses the broken Hermes agent loop
      try {
        const ollamaRes = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwythos:9b',
            prompt: commandText,
            stream: false,
          }),
        });
        if (!ollamaRes.ok) throw new Error(`Ollama HTTP ${ollamaRes.status}`);
        const data = await ollamaRes.json();
        const reply = data.response?.trim() || 'No response from model.';
        updateStageStatus(stageId, 'completed');
        appendLog({ stageId, status: 'completed', commandText, summary: reply });
        // Auto-generate TTS
        if (reply.length > 0) {
          runStage('jarvis_voice_reply', reply, { isTTS: true }).catch(() => {});
        }
        return { ok: true, summary: reply };
      } catch (err: any) {
        updateStageStatus(stageId, 'failed');
        appendLog({ stageId, status: 'failed', commandText, summary: err.message || 'Ollama call failed.' });
        return { ok: false };
      }
    } else {
      // Direct Ornith Code-Mode LLM call
      const res = await fetch(ORNITH_SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ORNITH_MODEL_NAME,
          messages: [
            { role: 'system', content: `You are Ornith, executing stage: ${STAGE_CONFIG[stageId].label}. Provide a very concise status update of your action.` },
            { role: 'user', content: commandText }
          ],
          stream: false
        })
      });

      if (!res.ok) throw new Error('Ornith API returned error');
      const data = await res.json();
      const reply = data.message?.content || 'Completed directly via Ornith.';
      
      updateStageStatus(stageId, 'completed');
      appendLog({ stageId, status: 'completed', commandText, summary: reply });
      return { ok: true, summary: reply };
    }
  } catch (err: any) {
    updateStageStatus(stageId, 'failed');
    appendLog({ stageId, status: 'failed', commandText, summary: err.message || 'Unknown error occurred.' });
    return { ok: false };
  }
}

export const PIPELINE: StageId[] = [
  'job_discovery',
  'welders_researcher',
  'email_copywriter',
  'video_agent',
  'deploy_output',
  'jarvis_voice_reply',
];

export const QWABLE_PIPELINE: StageId[] = [
  'code_generation',
  'preview_build',
  'save_workspace',
];

export async function runPipeline(commandText: string) {
  const lm = commandText.toLowerCase();
  const isQwable =
    lm.includes('build a landing page') ||
    lm.includes('make a game ui') ||
    lm.includes('generate a new dashboard') ||
    lm.includes('preview the app') ||
    lm.includes('qwable') ||
    lm.includes('coding page') ||
    (lm.includes('build') && (lm.includes('page') || lm.includes('ui') || lm.includes('dashboard') || lm.includes('preview')));

  if (isQwable) {
    QWABLE_PIPELINE.forEach(stageId => updateStageStatus(stageId, 'idle'));
    let lastSummary = commandText;
    for (const stageId of QWABLE_PIPELINE) {
      const result = await runStage(stageId, commandText);
      if (!result.ok) {
        appendLog({ stageId, status: 'failed', commandText, summary: `Pipeline halted at ${STAGE_CONFIG[stageId].label}.` });
        break;
      }
      lastSummary = result.summary || lastSummary;
    }
    return;
  }

  // Reset all to idle
  PIPELINE.forEach(stageId => updateStageStatus(stageId, 'idle'));
  
  let lastSummary = commandText;
  
  for (const stageId of PIPELINE) {
    if (stageId === 'jarvis_voice_reply') {
      await runStage(stageId, lastSummary, { isTTS: true });
    } else {
      const result = await runStage(stageId, commandText, { viaHermes: true });
      if (!result.ok) {
        appendLog({ stageId, status: 'failed', commandText, summary: `Pipeline halted at ${STAGE_CONFIG[stageId].label}.` });
        break;
      }
      lastSummary = result.summary || lastSummary;
    }
  }
}

export async function runVoicePipelineTest(): Promise<{ ok: boolean; error?: string }> {
  // Step 1: Input / Command
  updateStageStatus('input', 'running');
  appendLog({
    stageId: 'input',
    status: 'running',
    commandText: 'Jarvis voice online',
    summary: 'Starting voice pipeline test...'
  });
  
  try {
    updateStageStatus('input', 'completed');
    appendLog({
      stageId: 'input',
      status: 'completed',
      commandText: 'Jarvis voice online',
      summary: 'Test command received.'
    });
    
    // Step 2: Run voice reply stage
    updateStageStatus('jarvis_voice_reply', 'running');
    appendLog({
      stageId: 'jarvis_voice_reply',
      status: 'running',
      commandText: 'Jarvis voice online',
      summary: 'Generating audio test output...'
    });
    
    const result = await runStage('jarvis_voice_reply', 'Jarvis voice online', { isTTS: true });
    
    if (result.ok) {
      updateStageStatus('jarvis_voice_reply', 'completed');
      appendLog({
        stageId: 'jarvis_voice_reply',
        status: 'completed',
        commandText: 'Jarvis voice online',
        summary: 'Jarvis voice pipeline test: passed'
      });
      return { ok: true };
    } else {
      throw new Error(result.summary || 'TTS playback failed');
    }
  } catch (err: any) {
    updateStageStatus('jarvis_voice_reply', 'failed');
    appendLog({
      stageId: 'jarvis_voice_reply',
      status: 'failed',
      commandText: 'Jarvis voice online',
      summary: `Jarvis voice failed: ${err.message}`
    });
    return { ok: false, error: err.message };
  }
}
