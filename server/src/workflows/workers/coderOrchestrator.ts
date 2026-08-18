import { logger } from '../../utils/logger.js';
import { runAgentLoop } from '../../services/agent/agentLoop.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface OrchestratorInput {
  task: string;
  workdir?: string;
}

function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {}

  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
  } catch (e) {}

  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace >= firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
  } catch (e) {}

  throw new Error("Failed to extract valid JSON from response.");
}

// Helper for safe normalization
function normalizeStringArray(val: any): any[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val;
  return [];
}

// Lightweight Validators
function validateClarify(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  return {
    skipped: !!data.skipped,
    summary: data.summary || '',
    questions: normalizeStringArray(data.questions),
    answers: normalizeStringArray(data.answers)
  };
}

function validatePlan(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  const steps = normalizeStringArray(data.steps);
  if (steps.length === 0) throw new Error("Missing or invalid 'steps' array");
  return { summary: data.summary || '', steps };
}

function validateFileFind(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  const files = normalizeStringArray(data.files);
  if (files.length === 0) throw new Error("Missing or invalid 'files' array");
  return { summary: data.summary || '', files };
}

function validateEdit(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  const changedFiles = normalizeStringArray(data.changedFiles);
  if (typeof data.patchesApplied !== 'number') throw new Error("Missing or invalid 'patchesApplied' numeric field");
  return { 
    summary: data.summary || '', 
    changedFiles, 
    patchesApplied: data.patchesApplied 
  };
}

function validateDiff(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  const changeSummary = normalizeStringArray(data.changeSummary);
  if (changeSummary.length === 0) throw new Error("Missing or invalid 'changeSummary' array");
  return { summary: data.summary || '', changeSummary };
}

function validateExec(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  const commands = normalizeStringArray(data.commands);
  if (typeof data.exitCode !== 'number') throw new Error("Missing or invalid 'exitCode' numeric field");
  if (typeof data.stdoutPreview !== 'string') throw new Error("Missing or invalid 'stdoutPreview' string field");
  if (typeof data.stderrPreview !== 'string') throw new Error("Missing or invalid 'stderrPreview' string field");
  return {
    summary: data.summary || '',
    commands,
    exitCode: data.exitCode,
    stdoutPreview: data.stdoutPreview,
    stderrPreview: data.stderrPreview
  };
}

function validateReview(data: any) {
  if (typeof data !== 'object' || !data) throw new Error("Expected object");
  if (!['passed', 'warning', 'failed'].includes(data.status)) throw new Error("Status must be 'passed', 'warning', or 'failed'");
  return {
    status: data.status,
    summary: data.summary || '',
    issues: normalizeStringArray(data.issues),
    recommendedFixes: normalizeStringArray(data.recommendedFixes)
  };
}

async function executeStageWithRetry<T>(
  stageName: string,
  prompt: string,
  context: string,
  provider: string,
  maxIterations: number,
  validator: (data: any) => T,
  logger: (msg: string) => void,
  logError: (msg: string) => void
): Promise<{ data?: T; status: 'success' | 'failed'; failureObject?: any }> {
  let attempt = 1;
  let currentContext = context;
  let lastRaw = '';
  let lastError = '';

  while (attempt <= 2) {
    logger(`Stage: ${stageName} (Attempt ${attempt})`);
    try {
      let res = await runAgentLoop(prompt, currentContext, maxIterations, provider);
      
      // Inject intentional malformed text for test
      if (currentContext.includes('MALFORMED_TEST') && stageName === 'Clarify' && attempt === 1) {
        logError("Injecting intentionally malformed JSON for test.");
        res.text = "Here is my response:\n{ skipped: true, \"summary\": oops this is broken json ]";
      }

      lastRaw = res.text;

      try {
        const parsed = extractJson(res.text);
        const validated = validator(parsed);
        return { data: validated, status: 'success' };
      } catch (e: any) {
        lastError = e.message;
        logError(`Parse/Validate failed: ${e.message}`);
        if (attempt === 1) {
          currentContext += `\n\n[SYSTEM] Your previous response failed JSON validation: ${e.message}\nPlease fix the JSON formatting and try again. Previous raw output:\n${res.text}`;
        }
      }
    } catch (e: any) {
      lastError = e.message;
      logError(`Agent Loop crashed: ${e.message}`);
    }
    attempt++;
  }
  
  return { 
    status: 'failed', 
    failureObject: {
      ok: false,
      stage: stageName.toLowerCase(),
      type: "schema_validation_error",
      message: lastError || "Max retries exceeded",
      rawOutput: lastRaw,
      attempts: 2
    }
  };
}

export async function runCoderOrchestrator(input: OrchestratorInput): Promise<any> {
  const provider = 'OmniRoute';
  const workdir = input.workdir || process.cwd();
  
  const result: any = {
    status: 'failed',
    task: input.task,
    provider: { name: 'omniroute', model: 'auto' },
    stages: {
      clarify: { status: 'skipped', summary: '', questions: [], answers: [], skipped: true },
      plan: { status: 'skipped', summary: '', steps: [] },
      fileFind: { status: 'skipped', summary: '', files: [] },
      edit: { status: 'skipped', summary: '', changedFiles: [], patchesApplied: [] },
      diffSummary: { status: 'skipped', summary: '', changeSummary: [] },
      exec: { status: 'skipped', summary: '', commands: [], exitCode: 0, stdoutPreview: '', stderrPreview: '' },
      review: { status: 'skipped', summary: '', issues: [], recommendedFixes: [] }
    },
    artifacts: { changedFiles: [], createdFiles: [], deletedFiles: [] },
    retry: { count: 0, max: 2, history: [] },
    nextActions: [
      { id: 'run-tests', label: 'Run broader test suite' },
      { id: 'open-diff', label: 'Review applied patches' }
    ],
    logs: { timeline: [], errors: [] }
  };

  const log = (msg: string) => {
    logger.info(`[Coder] ${msg}`);
    result.logs.timeline.push(`[${new Date().toISOString()}] ${msg}`);
  };
  const logErr = (msg: string) => {
    logger.error(`[Coder Error] ${msg}`);
    result.logs.errors.push(`[${new Date().toISOString()}] ${msg}`);
  };

  let currentContext = `Original Task: ${input.task}\nWorking Directory: ${workdir}\n`;

  try {
    // 1. Clarify
    const clarifyRes = await executeStageWithRetry(
      'Clarify',
      `You are the ClarifyAgent. Analyze the task. If vague or underspecified, output questions and assumptions. If it's clear, skip. MUST OUTPUT EXACT JSON AT THE END: { "skipped": boolean, "summary": "...", "questions": ["..."], "answers": ["..."] }`,
      currentContext, provider, 3, validateClarify, log, logErr
    );
    if (clarifyRes.status === 'failed') {
      clarifyRes.failureObject.history = result.retry.history;
      return clarifyRes.failureObject;
    }
    result.stages.clarify = { status: clarifyRes.data!.skipped ? 'skipped' : 'success', ...clarifyRes.data! };
    if (!clarifyRes.data!.skipped) currentContext += `\n\n--- Clarification ---\n${clarifyRes.data!.summary}`;

    // 2. Plan
    const planRes = await executeStageWithRetry(
      'Plan',
      `You are the PlannerAgent. Formulate an ordered implementation plan based on the task context. MUST OUTPUT EXACT JSON AT THE END: { "summary": "...", "steps": ["..."] }`,
      currentContext, provider, 5, validatePlan, log, logErr
    );
    if (planRes.status === 'failed') {
      planRes.failureObject.history = result.retry.history;
      return planRes.failureObject;
    }
    result.stages.plan = { status: 'success', ...planRes.data! };
    currentContext += `\n\n--- Plan ---\n${JSON.stringify(planRes.data!.steps)}`;

    // 3. File-Find
    const findRes = await executeStageWithRetry(
      'File-Find',
      `You are the FileFinderAgent. Use tools (search_files, read_file) to identify relevant files for the plan. MUST OUTPUT EXACT JSON AT THE END: { "summary": "...", "files": ["src/app.ts"] }`,
      currentContext, provider, 8, validateFileFind, log, logErr
    );
    if (findRes.status === 'failed') {
      findRes.failureObject.history = result.retry.history;
      return findRes.failureObject;
    }
    result.stages.fileFind = { status: 'success', ...findRes.data! };
    currentContext += `\n\n--- Target Files ---\n${JSON.stringify(findRes.data!.files)}`;

    // Repo signals for Exec Policy
    let packageJson = '';
    try { packageJson = await readFile(join(workdir, 'package.json'), 'utf-8'); } catch(e) {}
    const repoSignals = `package.json exists: ${!!packageJson}\nScripts:\n${packageJson ? JSON.stringify(JSON.parse(packageJson).scripts || {}) : 'None'}`;

    // Main Loop
    let finalStatus: 'success' | 'partial' | 'failed' = 'failed';
    
    while (result.retry.count <= result.retry.max) {
      // 4. Edit
      const editRes = await executeStageWithRetry(
        'Edit',
        `You are the EditorAgent. Execute the plan. PREFER patch_file for existing files. Use write_file ONLY for new files or explicit full rewrites. MUST OUTPUT EXACT JSON AT THE END: { "summary": "...", "changedFiles": ["..."], "patchesApplied": 0 }`,
        currentContext, provider, 15, validateEdit, log, logErr
      );
      if (editRes.status === 'failed') {
        editRes.failureObject.history = result.retry.history;
        return editRes.failureObject;
      }
      result.stages.edit = { status: 'success', ...editRes.data! };
      result.artifacts.changedFiles = [...new Set([...result.artifacts.changedFiles, ...editRes.data!.changedFiles])];
      currentContext += `\n\n--- Edits Applied ---\n${JSON.stringify(editRes.data!.changedFiles)}`;

      // 5. Diff-Summary
      const diffRes = await executeStageWithRetry(
        'Diff-Summary',
        `You are the DiffAgent. Summarize the changes applied before execution. MUST OUTPUT EXACT JSON AT THE END: { "summary": "...", "changeSummary": ["..."] }`,
        currentContext, provider, 3, validateDiff, log, logErr
      );
      if (diffRes.status === 'failed') {
        diffRes.failureObject.history = result.retry.history;
        return diffRes.failureObject;
      }
      result.stages.diffSummary = { status: 'success', ...diffRes.data! };

      // 6. Exec
      const execRes = await executeStageWithRetry(
        'Exec',
        `You are the ExecAgent. Follow Guarded Exec Policy: 1. Inspect signals: ${repoSignals}. 2. Infer commands from known scripts (prefer npm/yarn test/lint/build). 3. Do NOT invent arbitrary shell commands. 4. Use terminal tool. MUST OUTPUT EXACT JSON AT THE END: { "summary": "...", "commands": ["..."], "exitCode": 0, "stdoutPreview": "...", "stderrPreview": "..." }`,
        currentContext, provider, 10, validateExec, log, logErr
      );
      if (execRes.status === 'failed') {
        execRes.failureObject.history = result.retry.history;
        return execRes.failureObject;
      }
      result.stages.exec = { status: execRes.data!.exitCode === 0 ? 'success' : 'failed', ...execRes.data! };

      // 7. Review
      const reviewRes = await executeStageWithRetry(
        'Review',
        `You are the ReviewerAgent. Review changes and Exec output (Exit Code: ${execRes.data!.exitCode}). MUST OUTPUT EXACT JSON AT THE END: { "status": "passed" | "warning" | "failed", "summary": "...", "issues": ["..."], "recommendedFixes": ["..."] }`,
        `Context:\n${currentContext}\n\nSTDOUT: ${execRes.data!.stdoutPreview}\nSTDERR: ${execRes.data!.stderrPreview}`,
        provider, 5, validateReview, log, logErr
      );
      if (reviewRes.status === 'failed') {
        reviewRes.failureObject.history = result.retry.history;
        return reviewRes.failureObject;
      }
      result.stages.review = reviewRes.data!;

      if (reviewRes.data!.status === 'passed') {
        finalStatus = 'success';
        break;
      } else {
        if (result.retry.count < result.retry.max) {
          log(`Review issue found. Retrying loop.`);
          result.retry.history.push({ attempt: result.retry.count + 1, issues: reviewRes.data!.issues });
          currentContext += `\n\n--- Review Failed ---\nIssues: ${JSON.stringify(reviewRes.data!.issues)}\nPlease fix these in the next edit pass.`;
          result.retry.count++;
        } else {
          finalStatus = reviewRes.data!.status === 'warning' ? 'partial' : 'failed';
          break;
        }
      }
    }
    
    result.status = finalStatus;

  } catch (err: any) {
    return {
      ok: false,
      stage: "orchestrator",
      type: "hard_crash",
      message: err.message,
      rawOutput: "",
      attempts: 1,
      history: result.retry.history
    };
  }

  return result;
}
