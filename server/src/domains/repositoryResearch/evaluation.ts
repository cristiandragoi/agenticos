import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { researchStore } from './store.js';

export function isRepositoryEvaluationRequest(text: string): boolean {
  return !/^\s*(?:stop|cancel|don't|do not)\b/i.test(text) &&
    /\b(?:evaluate|test|benchmark)\b/i.test(text) &&
    /\b(?:recommended|selected|candidate|agent-browser|sandbox)\b/i.test(text) &&
    /\b(?:repository|repo|candidate|agent-browser)\b/i.test(text);
}
const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
function command(args: string[], signal?: AbortSignal, onLine?: (line: string) => void): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', pending = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk; pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
      lines.forEach(line => onLine?.(line));
      if (output.length > 2_000_000) child.kill();
    });
    child.stderr.on('data', chunk => { output += chunk; if (output.length > 2_000_000) child.kill(); });
    child.on('error', reject);
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason);
      if (code !== 0) return reject(new Error('The isolated browser evaluation failed; no working capability or latency improvement has been verified.'));
      resolve(output);
    });
  });
}

export async function evaluateSelectedRepository(input: { conversationId: string; goalId: string; signal?: AbortSignal; onProgress?: (text: string) => void }) {
  input.signal?.throwIfAborted();
  const saved = researchStore.latestForConversation(input.conversationId);
  if (!saved?.report?.top?.[0]) throw new Error('There is no saved recommended repository in this conversation to evaluate.');
  const repository = saved.report.top[0].repository;
  if (repository !== 'vercel-labs/agent-browser') throw new Error(`The saved candidate ${repository} has no reviewed sandbox profile. It has not been executed; no new search was started.`);
  const profile = JSON.parse(await readFile(fileURLToPath(new URL('../../../scripts/research-browser/profile.json', import.meta.url)), 'utf8')
    .catch(() => { throw new Error('The reviewed browser sandbox has not been prepared on this installation.'); }));
  if (!/^sha256:[a-f0-9]{64}$/.test(profile.imageId)) throw new Error('Reviewed evaluation image is unavailable.');
  const controller = new AbortController();
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), controller.signal]);
  const timeout = setTimeout(() => controller.abort(new Error('The sandbox evaluation timed out. No integration was performed.')), 120_000);
  const name = `agenticos-research-${randomUUID()}`;
  const progress = (text: string) => {
    researchStore.finish(saved.id, { ...saved.report, evaluation: { goalId: input.goalId, repository, lastEvent: text, at: new Date().toISOString() } });
    try { input.onProgress?.(text); } catch { /* progress never owns execution */ }
  };
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cleaned = false;
  try {
    progress('I am starting the saved browser tool in an isolated container.');
    await command(['create', '--name', name, '--label', 'agenticos.research=browser-evaluation', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534', '--cpus', '2', '--memory', '1536m', '--memory-swap', '1536m', '--pids-limit', '192', '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=536870912,mode=1777', profile.imageId], signal);
    const container = JSON.parse(await command(['inspect', name], signal))[0];
    const config = container.HostConfig;
    if (container.Image !== profile.imageId || container.Config.User !== '65534:65534' || config.NetworkMode !== 'none' || !config.ReadonlyRootfs || config.Privileged || config.Binds?.length || container.Mounts?.some((m: any) => m.Type !== 'tmpfs') || !config.CapDrop.includes('ALL') || !config.SecurityOpt.includes('no-new-privileges')) throw new Error('Sandbox isolation verification failed.');
    progress('The sandbox is ready. I am comparing verified page reading and button clicks.');
    heartbeat = setInterval(() => progress('The isolated browser tests are still running. I do not have a verified result yet.'), 20_000);
    let result: any;
    await command(['start', '-a', name], signal, line => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'trial' && event.backend === 'agent-browser' && (event.round === 0 || event.round === 2))
          progress(event.verified ? `Candidate trial ${event.round + 1} passed: reading, clicking and the page change were verified.` : 'The candidate failed verification.');
        if (event.type === 'result') result = event;
      } catch { /* not a structured harness event */ }
    });
    signal.throwIfAborted();
    if (!result?.verified || result.trials?.length !== 6 || !result.trials.every((t: any) => t.verified && t.readVerified && t.clickOutcomeVerified && t.elapsedMs > 0)) throw new Error('The sandbox did not return six verified browser trials.');
    const median = (backend: string) => result.trials.filter((t: any) => t.backend === backend).map((t: any) => t.elapsedMs).sort((a: number,b: number) => a-b)[1];
    const candidateMs = median('agent-browser'), baselineMs = median('playwright');
    const presentationText = `The isolated tests passed: the candidate read a test page, clicked its button and verified the page change in all three trials. Its median was ${(candidateMs/1000).toFixed(1)} seconds, compared with ${(baselineMs/1000).toFixed(1)} seconds for Playwright. This is a browser-library comparison, not a measurement of Jarvis voice latency or the full existing browser adapter. Nothing was integrated into production.`;
    const report = { ...result, candidateMs, baselineMs, imageId: profile.imageId, isolationVerified: true, presentationText };
    await command(['rm', '-f', name], AbortSignal.timeout(15_000)); cleaned = true;
    researchStore.finish(saved.id, { ...saved.report, evaluation: { goalId: input.goalId, repository, lastEvent: presentationText, report, at: new Date().toISOString() } });
    return report;
  } catch (error) {
    const message = input.signal?.aborted ? 'The sandbox evaluation was cancelled.' : error instanceof Error ? error.message : 'The sandbox evaluation failed.';
    researchStore.finish(saved.id, { ...saved.report, evaluation: { goalId: input.goalId, repository, lastEvent: message, error: true, at: new Date().toISOString() } });
    throw error;
  } finally {
    clearTimeout(timeout); if (heartbeat) clearInterval(heartbeat);
    if (!cleaned) await command(['rm', '-f', name], AbortSignal.timeout(15_000));
  }
}
