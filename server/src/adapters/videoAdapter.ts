import { randomUUID } from 'crypto';
import type {
  RuntimeAdapter, RuntimeHealth, AgentDefinition, AgentInvocation,
  InvocationAck, RuntimeEvent, RunRecord, ToolDefinition, MemoryScope,
  VideoJobRecord, VideoFormat, VideoStage
} from '../types.js';
import { runStore } from '../services/runStore.js';

/* ══════════════════════════════════════════════════════
   Video-Agent Adapter
   Simulates a multi-stage video production pipeline.
   Stage progression: scripting → asset-gathering →
   rendering → review → publish
   
   Real rendering hooks can be inserted at the
   `renderStage` seam below. Supported engines:
   - Remotion (spawn: `npx remotion render ...`)
   - Creatomate (POST to https://api.creatomate.com/v1/renders)
   - FFmpeg (spawn: `ffmpeg -i ...`)
   ══════════════════════════════════════════════════════ */

const STAGE_ORDER: VideoStage[] = [
  'scripting', 'asset-gathering', 'rendering', 'review', 'publish'
];

const STAGE_DURATION_MS: Record<VideoStage, number> = {
  'scripting': 800,
  'asset-gathering': 1200,
  'rendering': 2000,
  'review': 600,
  'publish': 400,
};

import path from 'path';
import { fileURLToPath } from 'url';
import { JsonStore } from '../services/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

export const videoJobStore = new JsonStore<VideoJobRecord>(path.join(dataDir, 'videoJobs.json'));
export const videoJobClients = new Map<string, any[]>(); // jobId -> SSE clients

function nextStage(current: VideoStage): VideoStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

function notifyVideoClients(jobId: string, event: Record<string, unknown>): void {
  const clients = videoJobClients.get(jobId) || [];
  const payload = `event: video_stage\ndata: ${JSON.stringify(event)}\n\n`;
  clients.forEach(c => { try { c.write(payload); } catch (_) {} });
}

export async function progressVideoJob(jobId: string): Promise<void> {
  const job = videoJobStore.get(jobId);
  if (!job || job.status === 'completed' || job.status === 'failed') return;

  const currentStage = job.stage;
  const duration = STAGE_DURATION_MS[currentStage];

  notifyVideoClients(jobId, { stage: currentStage, status: 'running', jobId });

  await new Promise(r => setTimeout(r, duration));

  // Real render hook seam — insert actual API call here when env key present:
  // if (currentStage === 'rendering' && process.env.REMOTION_OUTPUT_DIR) {
  //   await spawnRemotion(job);
  // }

  const next = nextStage(currentStage);
  if (next) {
    const updated: VideoJobRecord = { ...job, stage: next, updatedAt: new Date().toISOString() };
    videoJobStore.upsert(updated);
    notifyVideoClients(jobId, { stage: next, status: 'running', jobId });
    // Continue progressing asynchronously
    setTimeout(() => progressVideoJob(jobId), 100);
  } else {
    const completed: VideoJobRecord = {
      ...job,
      stage: 'publish',
      status: 'completed',
      artifactId: `art-video-${jobId}`,
      updatedAt: new Date().toISOString(),
    };
    videoJobStore.upsert(completed);
    runStore.update(job.runId, { status: 'completed', output: `Video "${job.request.prompt}" published successfully.` });
    notifyVideoClients(jobId, { stage: 'publish', status: 'completed', artifactId: completed.artifactId, jobId });
  }
}

export class VideoAdapter implements RuntimeAdapter {
  id = 'rt-video';
  label = 'Video-Agent Runtime';

  async health(): Promise<RuntimeHealth> {
    return { status: 'healthy', lastCheck: new Date().toISOString(), latencyMs: 5 };
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return []; // agent-video is registered in mockAgents
  }

  async invoke(input: AgentInvocation): Promise<InvocationAck> {
    const run: RunRecord = {
      id: input.runId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      mode: input.mode,
      status: 'running',
      input: input.prompt,
      logs: ['[VideoAgent] Job accepted', '[VideoAgent] Starting pipeline'],
      events: [],
      linkedArtifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    runStore.create(run);
    return { status: 'accepted', runId: input.runId };
  }

  async *stream(input: AgentInvocation): AsyncIterable<RuntimeEvent> {
    yield { type: 'status', payload: { status: 'running' }, timestamp: new Date().toISOString() };
    for (const stage of STAGE_ORDER) {
      await new Promise(r => setTimeout(r, STAGE_DURATION_MS[stage]));
      yield { type: 'video_stage', payload: { stage, status: 'running' }, timestamp: new Date().toISOString() };
    }
    yield { type: 'run_status', payload: { status: 'completed' }, timestamp: new Date().toISOString() };
  }

  async cancel(runId: string): Promise<void> {
    runStore.update(runId, { status: 'failed', errorMessage: 'Cancelled by user' });
  }

  async getRun(runId: string): Promise<RunRecord> {
    const run = runStore.get(runId);
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404, code: 'NOT_FOUND' });
    return run;
  }

  async listTools(): Promise<ToolDefinition[]> { return []; }
  async listMemoryScopes(): Promise<MemoryScope[]> { return []; }
}
