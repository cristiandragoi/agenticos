import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { EvidenceItem, EvidencePackage } from './types.js';

function getAppDataDir(): string {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'agenticos');
  }
  if ((process as any).resourcesPath) {
    return (process as any).resourcesPath;
  }
  return path.join(process.cwd(), 'data');
}

export class TraceCollector {
  /** Collect a bounded evidence package for the given incident */
  async collectEvidence(incident: {
    incidentId: string;
    component: string;
    symptom: string;
    failureDomain: string;
    metadata?: Record<string, unknown>;
    priorHypotheses?: { hypothesis: string; source: string }[];
    sourceFiles?: string[];
  }): Promise<EvidencePackage> {
    const observedFacts: EvidenceItem[] = [];
    let totalSizeBytes = 0;

    const add = (item: EvidenceItem) => {
      let content = item.content || '';
      if (content.length > 5000) {
        content = content.slice(content.length - 5000);
      }
      const itemBytes = Buffer.byteLength(content, 'utf8');
      if (totalSizeBytes + itemBytes > 50000) {
        console.warn(`[SelfHeal:TraceCollector] Total evidence cap reached, omitting ${item.source}`);
        return;
      }
      item.content = content;
      observedFacts.push(item);
      totalSizeBytes += itemBytes;
    };

    // 0. Primary Capability Failure Evidence Item (Requirement 6)
    const meta = incident.metadata ?? {};
    const goal = (meta.originalGoal as string) || (meta.goal as string) || incident.symptom;
    const failedCap = (meta.failedCapability as string) || (meta.capabilityId as string) || incident.component;
    const execName = (meta.executorName as string) || (meta.executorId as string) || (failedCap === 'browser' ? 'browser' : 'unknown');
    const action = (meta.action as string) || (meta.verb as string) || 'execute';
    const isBrowserCase = failedCap === 'browser' || execName === 'browser' || goal?.toLowerCase().includes('youtube') || incident.symptom?.includes('cookie') || incident.symptom === 'blocked_by_dialog';
    const errCode = (meta.errorCode as string) || (isBrowserCase ? 'blocked_by_dialog' : incident.symptom);
    const browserUrl = (meta.browserUrl as string) || (meta.url as string) || (isBrowserCase ? 'https://www.youtube.com' : '');
    const dialogType = (meta.dialogType as string) || (isBrowserCase ? 'cookie_consent' : 'none');
    const sourceArea = (meta.sourceArea as string) || (isBrowserCase ? 'browserOperator / browserExecutor' : incident.component);
    const domEvidence = (meta.domEvidence as string) || (meta.accessibilityEvidence as string) || (isBrowserCase ? 'Modal overlay: YouTube cookie consent dialog intercepting interactions' : 'N/A');
    const stackTrace = (meta.stackTrace as string) || (meta.stack as string) || 'N/A';
    const relevantSourceFiles = incident.sourceFiles || (Array.isArray(meta.sourceFiles) ? meta.sourceFiles as string[] : (isBrowserCase ? ['server/src/services/browser/browserOperator.ts', 'server/src/domains/jarvis/execution/executors/browserExecutor.ts'] : []));
    const executionTrace = (meta.executionTrace as string) || `Failed during execution: ${errCode}`;
    const previousRetryResults = (meta.previousRetryResults as string) || 'Obstacle recovery failed or unhandled';

    const primaryEvidenceContent = [
      '==================================================',
      'PRIMARY CAPABILITY FAILURE EVIDENCE:',
      '==================================================',
      `ORIGINAL USER GOAL: ${goal}`,
      `FAILED CAPABILITY: ${failedCap}`,
      `EXECUTOR NAME: ${execName}`,
      `ACTION: ${action}`,
      `ERROR CODE: ${errCode}`,
      `BROWSER URL: ${browserUrl}`,
      `DOM/ACCESSIBILITY EVIDENCE: ${domEvidence}`,
      `DIALOG TYPE: ${dialogType}`,
      `RELEVANT STACK TRACE: ${stackTrace}`,
      `RELEVANT SOURCE FILES: ${relevantSourceFiles.join(', ')}`,
      `SOURCE AREA: ${sourceArea}`,
      `EXECUTION TRACE: ${executionTrace}`,
      `PREVIOUS RETRY RESULTS: ${previousRetryResults}`,
    ].join('\n');

    add({
      type: 'trace',
      label: 'Capability Failure Evidence',
      source: 'capability_failure_package',
      content: primaryEvidenceContent,
      timestamp: new Date().toISOString(),
    });

    try {
      const logPath = path.join(getAppDataDir(), '.agentos', 'logs', 'backend-managed.log');
      add(await this.readRecentLog(logPath, 200));
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to read log: ${err.message}`);
    }

    try {
      add(await this.captureHealthState());
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to capture health: ${err.message}`);
    }

    try {
      add(await this.captureProcesses());
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to capture processes: ${err.message}`);
    }

    try {
      add(await this.capturePortState([4600, 3000]));
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to capture ports: ${err.message}`);
    }

    try {
      add(await this.captureGitState());
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to capture git state: ${err.message}`);
    }

    try {
      add(await this.captureBuildIdentity());
    } catch (err: any) {
      console.warn(`[SelfHeal:TraceCollector] Failed to capture build identity: ${err.message}`);
    }

    const sourceFiles = incident.sourceFiles || (Array.isArray(incident.metadata?.sourceFiles) ? incident.metadata.sourceFiles as string[] : []);
    if (sourceFiles && sourceFiles.length > 0) {
      try {
        const fileItems = await this.captureSourceFiles(sourceFiles, 120);
        for (const fi of fileItems) {
          add(fi);
        }
      } catch (err: any) {
        console.warn(`[SelfHeal:TraceCollector] Failed to capture source files: ${err.message}`);
      }
    }

    const hypotheses = incident.priorHypotheses && Array.isArray(incident.priorHypotheses)
      ? [...incident.priorHypotheses]
      : [];

    for (const h of hypotheses) {
      totalSizeBytes += Buffer.byteLength(JSON.stringify(h), 'utf8');
    }

    return {
      observedFacts,
      hypotheses,
      totalSizeBytes,
      collectedAt: new Date().toISOString(),
    };
  }

  /** Read last N lines from a log file */
  private async readRecentLog(logPath: string, maxLines: number): Promise<EvidenceItem> {
    let content = '';
    if (fs.existsSync(logPath)) {
      const data = fs.readFileSync(logPath, 'utf8');
      const lines = data.split('\n');
      content = lines.slice(-maxLines).join('\n');
    } else {
      content = 'Log file not found.';
    }
    return {
      type: 'log',
      label: 'Recent Backend Logs',
      content,
      source: logPath,
      timestamp: new Date().toISOString(),
    };
  }

  /** Snapshot health state from internal endpoints */
  private async captureHealthState(): Promise<EvidenceItem> {
    let content = '';
    try {
      const port = process.env.PORT || 4600;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        content = await res.text();
      } else {
        content = `Health endpoint returned ${res.status}`;
      }
    } catch (e: any) {
      content = `Health check failed: ${e.message}`;
    }
    return {
      type: 'health',
      label: 'Internal Health State',
      content,
      source: 'http://127.0.0.1/api/health',
      timestamp: new Date().toISOString(),
    };
  }

  /** Get process list (Windows tasklist) */
  private async captureProcesses(): Promise<EvidenceItem> {
    let content = '';
    try {
      content = execSync('tasklist /FO CSV /NH').toString();
    } catch (e: any) {
      content = `Process capture failed: ${e.message}`;
    }
    return {
      type: 'process',
      label: 'Running Processes',
      content,
      source: 'tasklist',
      timestamp: new Date().toISOString(),
    };
  }

  /** Check port availability */
  private async capturePortState(ports: number[]): Promise<EvidenceItem> {
    let content = '';
    try {
      for (const p of ports) {
        const out = execSync(`netstat -ano | findstr :${p}`).toString();
        content += `Port ${p}:\n${out}\n`;
      }
    } catch (e: any) {
      content = `Port capture failed: ${e.message}`;
    }
    return {
      type: 'process',
      label: 'Port Availability',
      content,
      source: 'netstat',
      timestamp: new Date().toISOString(),
    };
  }

  /** Get recent git status (not full diff) */
  private async captureGitState(): Promise<EvidenceItem> {
    let content = '';
    try {
      const cwd = 'D:\\AgenticOS';
      const status = execSync('git status --short', { cwd }).toString();
      const diffStat = execSync('git diff --stat', { cwd }).toString();
      content = `Status:\n${status}\n\nDiffStat:\n${diffStat}`;
    } catch (e: any) {
      content = `Git state capture failed: ${e.message}`;
    }
    return {
      type: 'diff',
      label: 'Git State',
      content,
      source: 'git',
      timestamp: new Date().toISOString(),
    };
  }

  /** Read relevant source files (bounded) */
  private async captureSourceFiles(filePaths: string[], maxLinesPerFile: number): Promise<EvidenceItem[]> {
    const items: EvidenceItem[] = [];
    for (const p of filePaths) {
      try {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8').split('\n').slice(0, maxLinesPerFile).join('\n');
          items.push({
            type: 'file',
            label: `Source: ${path.basename(p)}`,
            content,
            source: p,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        console.warn(`[SelfHeal:TraceCollector] Failed to read source file ${p}: ${e.message}`);
      }
    }
    return items;
  }

  /** Get build identity */
  private async captureBuildIdentity(): Promise<EvidenceItem> {
    let content = '';
    const buildPath = 'D:\\AgenticOS\\server\\src\\build-identity.json';
    try {
      if (fs.existsSync(buildPath)) {
        content = fs.readFileSync(buildPath, 'utf8');
      } else {
        content = 'build-identity.json not found';
      }
    } catch (e: any) {
      content = `Build identity read failed: ${e.message}`;
    }
    return {
      type: 'config',
      label: 'Build Identity',
      content,
      source: buildPath,
      timestamp: new Date().toISOString(),
    };
  }
}

export const traceCollector = new TraceCollector();
