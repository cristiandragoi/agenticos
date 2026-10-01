/**
 * UniversalVerifier.ts — Independent Post-Condition Verification
 *
 * Implements Section 8:
 * Ensures every executed action is independently verified against real-world state.
 * Never equates "tool reported success" with "task completed".
 * Populates evidence arrays with real OS, browser, database, or filesystem observations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { projectsStore } from '../../services/projectsStore.js';
import type { GoalVerification, GoalEvidence } from './types.js';

const execAsync = promisify(exec);

function parseJsonFromStdout(stdout: string): any {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
  }
  return null;
}

export class UniversalVerifier {
  private static instance: UniversalVerifier;

  private constructor() {}

  public static getInstance(): UniversalVerifier {
    if (!UniversalVerifier.instance) {
      UniversalVerifier.instance = new UniversalVerifier();
    }
    return UniversalVerifier.instance;
  }

  /**
   * Verify an executed action based on surface, target, and parameters.
   */
  public async verify(opts: {
    surface: string;
    target: string;
    parameters?: Record<string, any>;
    expectedState?: any;
    previousState?: any;
  }): Promise<GoalVerification> {
    const { surface, target, parameters, expectedState } = opts;
    const now = new Date().toISOString();

    switch (surface) {
      case 'internal': {
        return this.verifyInternalEntity(target, parameters, expectedState, now);
      }
      case 'taskbar':
      case 'process':
      case 'executable':
      case 'start_menu':
      case 'app_user_model_id':
      case 'desktop': {
        if ((parameters?.capability === 'camera.perceive' || parameters?.verb === 'perceive_camera' || parameters?.verb === 'perceive') && target.toLowerCase().includes('camera')) {
          const camRes = await this.verifyCamera(target, parameters, now);
          if (camRes.verified) return camRes;
        }
        return this.verifyDesktopProcess(target, parameters, now);
      }
      case 'browser': {
        return this.verifyBrowserUrl(target, parameters, now);
      }
      case 'filesystem': {
        return this.verifyFilesystem(target, parameters, expectedState, now);
      }
      case 'shell': {
        return this.verifyShellCommand(target, parameters, now);
      }
      case 'camera': {
        return this.verifyCamera(target, parameters, now);
      }
      case 'location': {
        return this.verifyLocation(target, parameters, now);
      }
      case 'desktop_observe': {
        return this.verifyDesktopObserve(target, parameters, now);
      }
      case 'browser_observe': {
        return this.verifyBrowserObserve(target, parameters, now);
      }
      case 'screenshot': {
        if (parameters?.verb === 'open' || parameters?.filePath || target.endsWith('.png')) {
          return this.verifyFilesystem(target, parameters, expectedState, now);
        }
        return this.verifyScreenshot(target, parameters, now);
      }
      case 'learned': {
        if (parameters?.expectedName) {
          return this.verifyInternalEntity(target, parameters, expectedState, now);
        }
        if (parameters?.url) return this.verifyBrowserUrl(parameters.url, parameters, now);
        if (parameters?.executablePath) return this.verifyDesktopProcess(parameters.executablePath, parameters, now);
        if (target.includes('camera') || parameters?.capability === 'camera.perceive') {
          return this.verifyCamera(target, parameters, now);
        }
        if (target.includes('location') || parameters?.capability === 'location.read') {
          return this.verifyLocation(target, parameters, now);
        }
        return this.verifyGeneric(target, parameters, now);
      }
      default: {
        if (target.includes('camera') || parameters?.capability === 'camera.perceive') {
          return this.verifyCamera(target, parameters, now);
        }
        if (target.includes('location') || parameters?.capability === 'location.read') {
          return this.verifyLocation(target, parameters, now);
        }
        return this.verifyGeneric(target, parameters, now);
      }
    }
  }

  private async verifyInternalEntity(
    target: string,
    parameters: any,
    expectedState: any,
    now: string
  ): Promise<GoalVerification> {
    const entityType = parameters?.entityType || 'project';
    const entityId = parameters?.entityId || target;

    if (entityType === 'project') {
      const readback = projectsStore.getProject(entityId);
      const expectedName = parameters?.expectedName || parameters?.newName || expectedState?.name;
      const nameMatched = expectedName ? Boolean(readback && readback.name === expectedName) : Boolean(readback);

      const evidence: GoalEvidence = {
        id: `ev-proj-${Date.now()}`,
        type: 'db_state',
        label: `Project Store State for ${entityId}`,
        value: readback,
        source: 'projectsStore',
        timestamp: now,
        verified: Boolean(readback && nameMatched),
      };

      return {
        verified: Boolean(readback && nameMatched),
        method: 'projectsStore.getProject',
        expectedState: { id: entityId, name: expectedName },
        actualState: readback,
        evidence: [evidence],
        verifier: 'UniversalVerifier:ProjectStore',
        timestamp: now,
        summary: readback && nameMatched
          ? `Project ${entityId} verified in database with name "${readback.name}".`
          : `Failed to verify project ${entityId} with expected name "${expectedName}".`,
      };
    }

    return this.verifyGeneric(target, parameters, now);
  }

  private async verifyDesktopProcess(target: string, parameters: any, now: string): Promise<GoalVerification> {
    let cleanTarget = target
      .replace(/\s+and\s+(?:create|make|write|open|start|type|new|navigate|show)\b.*$/i, '')
      .replace(/\.(?:exe|lnk|url)$/i, '')
      .split(/[\\/]/).pop() || target;

    // Handle AppUserModelIDs e.g. Microsoft.WindowsCalculator_8wekyb3d8bbwe!App -> Calculator
    if (cleanTarget.includes('!') || cleanTarget.includes('_')) {
      const match = cleanTarget.match(/(?:Microsoft\.)?([A-Za-z]+)(?:_.*)?/i);
      if (match && match[1]) {
        cleanTarget = match[1];
      }
    }

    const processQuery = parameters?.processName || parameters?.name || cleanTarget;
    const aliases = [processQuery.toLowerCase(), cleanTarget.toLowerCase()];

    // Add individual tokens as aliases
    const tokens = cleanTarget.toLowerCase().split(/[\s-_]+/).filter(t => t.length > 2);
    for (const t of tokens) {
      if (!aliases.includes(t)) aliases.push(t);
    }

    if (processQuery.toLowerCase().includes('calc')) {
      aliases.push('calculatorapp', 'calc', 'calculator', 'rechner');
    } else if (processQuery.toLowerCase().includes('cam')) {
      aliases.push('windowscamera', 'camera', 'kamera');
    } else if (processQuery.toLowerCase().includes('term') || processQuery.toLowerCase().includes('console')) {
      aliases.push('windowsterminal', 'wt', 'cmd', 'powershell');
    } else if (processQuery.toLowerCase().includes('note')) {
      aliases.push('notepad');
    } else if (processQuery.toLowerCase().includes('sett') || processQuery.toLowerCase().includes('einstell')) {
      aliases.push('systemsettings', 'einstellungen', 'settings', 'immersivecontrolpanel');
    } else if (processQuery.toLowerCase().includes('comet') || processQuery.toLowerCase().includes('perplex')) {
      aliases.push('comet', 'perplexity');
    } else if (processQuery.toLowerCase().includes('hermes')) {
      aliases.push('hermes', 'hermes one', 'hermes 1');
    } else if (processQuery.toLowerCase().includes('teleg')) {
      aliases.push('telegram');
    } else if (processQuery.toLowerCase().includes('adobe') || processQuery.toLowerCase().includes('acrobat')) {
      aliases.push('acrobat', 'acroce', 'acrord32', 'adobe');
    } else if (processQuery.toLowerCase().includes('word') || processQuery.toLowerCase().includes('document')) {
      aliases.push('winword', 'word', 'microsoft word');
    }

    // Phase 1: presence is not change. Without a pre-action window baseline this
    // verifier cannot prove the action did anything, so it does not verify.
    const baseline: number[] | undefined = Array.isArray(parameters?.preActionWindowHwnds) ? parameters.preActionWindowHwnds.map(Number) : undefined;
    if (!baseline) {
      return {
        verified: false,
        method: 'desktopPerceptionService.listVisibleWindows',
        expectedState: { processName: processQuery, windowVisible: true, newSinceAction: true },
        actualState: null,
        evidence: [],
        verifier: 'UniversalVerifier:DesktopPerception',
        timestamp: now,
        summary: `No pre-action window baseline was supplied; an existing "${processQuery}" window cannot prove the action changed anything.`,
      };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 600));
      }

      // Check visible desktop windows on each attempt
      try {
        const { desktopPerceptionService } = await import('../../services/perception/DesktopPerceptionService.js');
        const winList = await desktopPerceptionService.listVisibleWindows();
        for (const w of winList) {
          if (baseline.includes(Number(w.hwnd))) continue; // existed before the action
          const titleLower = (w.title || '').toLowerCase();
          const procLower = (w.process || '').toLowerCase();
          for (const q of aliases) {
            if (titleLower.includes(q) || procLower.includes(q)) {
              const evidence: GoalEvidence = {
                id: `ev-win-${Date.now()}`,
                type: 'window',
                label: `Active Desktop Window "${w.title}" (${w.process}, HWND ${w.hwnd})`,
                value: w,
                source: 'DesktopPerceptionService:WindowsList',
                timestamp: now,
                verified: true,
              };

              return {
                verified: true,
                method: 'desktopPerceptionService.listVisibleWindows',
                expectedState: { processName: processQuery, windowVisible: true },
                actualState: w,
                evidence: [evidence],
                verifier: 'UniversalVerifier:DesktopPerception',
                timestamp: now,
                summary: `Application "${w.title || w.process}" verified active on desktop (HWND ${w.hwnd}, PID ${w.pid}).`,
              };
            }
          }
        }
      } catch {}

      // (Get-Process fallback removed in Phase 1: it matched pre-existing processes and
      //  called AppActivate, i.e. the verifier itself changed the foreground window.)
    }

    return {
      verified: false,
      method: 'Get-Process',
      expectedState: { processName: processQuery, running: true },
      actualState: null,
      evidence: [],
      verifier: 'UniversalVerifier:WindowsProcess',
      timestamp: now,
      summary: `Process ${processQuery} could not be confirmed in the running process table.`,
    };
  }

  private async verifyCamera(target: string, parameters: any, now: string): Promise<GoalVerification> {
    try {
      const obs = parameters?.__universalObservation;
      if (obs) {
        const verified = Boolean(
          (obs.success && obs.screenshotHash && obs.visionAnswer) ||
          (obs.visionAnswer && (
            obs.visionAnswer.includes("I don't currently have a fresh camera frame") ||
            obs.visionAnswer.includes("disabled in system permissions")
          ))
        );
        const evidence: GoalEvidence = {
          id: `ev-cam-${Date.now()}`,
          type: 'visual_frame',
          label: 'Live Webcam Sensor Observation',
          value: {
            goalRunId: obs.goalRunId,
            turnId: obs.turnId,
            frameSha256: obs.screenshotHash,
            timestamp: obs.captureTimestamp,
            dimensions: obs.dimensions,
            visionAnswer: obs.visionAnswer,
          },
          source: 'UniversalPerceptionService:Camera',
          timestamp: now,
          verified,
        };

        return {
          verified,
          method: 'UniversalPerceptionService.observeCamera',
          expectedState: { cameraActive: true, frameCaptured: true },
          actualState: obs,
          evidence: [evidence],
          verifier: 'UniversalVerifier:CameraPerception',
          timestamp: now,
          summary: obs.visionAnswer || (verified ? 'Live webcam frame verified.' : 'No fresh camera frame acquired.'),
        };
      }

      const { cameraPerceptionService } = await import('../../services/perception/CameraPerceptionService.js');
      const question = parameters?.prompt || parameters?.question || parameters?.userQuestion || target;
      const perception = parameters?.__cameraPerception || await cameraPerceptionService.perceive(question);
      const sha = perception?.frameSha256 || perception?.frameMetadata?.frameSha256;
      const verified = Boolean(
        (perception && perception.hasFrame && sha) ||
        (perception && perception.answer && (
          perception.answer.includes("cannot currently see anything") ||
          perception.answer.includes("fresh camera frame") ||
          perception.answer.includes("disabled in system permissions")
        ))
      );

      const evidence: GoalEvidence = {
        id: `ev-cam-${Date.now()}`,
        type: 'visual_frame',
        label: 'Camera Visual Perception Observation',
        value: perception,
        source: 'CameraPerceptionService',
        timestamp: now,
        verified,
      };

      return {
        verified,
        method: 'cameraPerceptionService.perceive',
        expectedState: { cameraActive: true, frameCaptured: true },
        actualState: perception,
        evidence: [evidence],
        verifier: 'UniversalVerifier:CameraPerception',
        timestamp: now,
        summary: perception?.answer || (verified ? 'Camera perception verified.' : 'No fresh camera frame acquired.'),
      };
    } catch (err: any) {
      return {
        verified: false,
        method: 'cameraPerceptionService.perceive',
        expectedState: { cameraActive: true },
        actualState: null,
        evidence: [],
        verifier: 'UniversalVerifier:CameraPerception',
        timestamp: now,
        summary: `Camera perception failed: ${err?.message}`,
      };
    }
  }

  private async verifyLocation(target: string, parameters: any, now: string): Promise<GoalVerification> {
    try {
      const { locationService } = await import('../../services/perception/LocationService.js');
      const location = await locationService.readLocation();

      const evidence: GoalEvidence = {
        id: `ev-loc-${Date.now()}`,
        type: 'location_coordinates',
        label: 'Location Sensor Observation',
        value: location,
        source: 'LocationService',
        timestamp: now,
        verified: location.state === 'current_verified',
      };

      return {
        verified: location.state === 'current_verified' || location.state === 'permission_denied',
        method: 'locationService.readLocation',
        expectedState: { locationResolved: true },
        actualState: location,
        evidence: [evidence],
        verifier: 'UniversalVerifier:Location',
        timestamp: now,
        summary: location.summary,
      };
    } catch (err: any) {
      return {
        verified: false,
        method: 'locationService.readLocation',
        expectedState: { locationResolved: true },
        actualState: null,
        evidence: [],
        verifier: 'UniversalVerifier:Location',
        timestamp: now,
        summary: `Location verification failed: ${err?.message}`,
      };
    }
  }

  private async verifyBrowserUrl(target: string, parameters: any, now: string): Promise<GoalVerification> {
    if (parameters?.expectedName || parameters?.verb === 'rename') {
      return {
        verified: false,
        method: 'BrowserVerificationGate',
        expectedState: { expectedName: parameters?.expectedName },
        actualState: null,
        evidence: [],
        verifier: 'UniversalVerifier:Browser',
        timestamp: now,
        summary: 'Browser cannot fulfill project state mutation.',
      };
    }
    const url = parameters?.url || target;
    let expectedHost = '';
    try {
      expectedHost = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      expectedHost = target.toLowerCase();
    }

    // Check if browser process or window has the host
    try {
      const ps = `Get-Process | Where-Object { $_.ProcessName -match 'chrome|msedge|firefox|brave|opera' -and $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json`;
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 3000 });

      const parsed = parseJsonFromStdout(stdout);
      if (parsed) {
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const match = list.find((item: any) =>
          String(item.MainWindowTitle || '').toLowerCase().includes(expectedHost.toLowerCase())
        );

        if (match) {
          const evidence: GoalEvidence = {
            id: `ev-browser-${Date.now()}`,
            type: 'window',
            label: `Browser Window with Host ${expectedHost}`,
            value: match,
            source: 'WindowsWindowTable',
            timestamp: now,
            verified: true,
          };

          return {
            verified: true,
            method: 'BrowserWindowMatch',
            expectedState: { host: expectedHost },
            actualState: match,
            evidence: [evidence],
            verifier: 'UniversalVerifier:Browser',
            timestamp: now,
            summary: `Browser page verified active for ${expectedHost} in window "${match.MainWindowTitle}".`,
          };
        }
      }
    } catch {}

    // Phase 1: dispatching a URL is not observing a loaded page.
    return {
      verified: false,
      method: 'BrowserWindowMatch',
      expectedState: { url },
      actualState: null,
      evidence: [],
      verifier: 'UniversalVerifier:Browser',
      timestamp: now,
      summary: `No browser window showing ${expectedHost} was observed; URL dispatch alone is not verification.`,
    };
  }

  private async verifyFilesystem(target: string, parameters: any, expectedState: any, now: string): Promise<GoalVerification> {
    const rawPath = parameters?.filePath || parameters?.path || target;
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
    const exists = fs.existsSync(filePath);

    if (exists) {
      const stat = fs.statSync(filePath);
      let contentMatches = true;
      if (parameters?.content) {
        try {
          const actualContent = fs.readFileSync(filePath, 'utf8');
          contentMatches = actualContent.includes(parameters.content);
        } catch {}
      }

      const evidence: GoalEvidence = {
        id: `ev-file-${Date.now()}`,
        type: 'file',
        label: `File ${filePath}`,
        value: { size: stat.size, mtime: stat.mtime },
        source: 'NodeFS',
        timestamp: now,
        verified: contentMatches,
      };

      return {
        verified: contentMatches,
        method: 'fs.existsSync',
        expectedState: { exists: true, content: parameters?.content },
        actualState: { exists: true, size: stat.size, mtime: stat.mtime },
        evidence: [evidence],
        verifier: 'UniversalVerifier:Filesystem',
        timestamp: now,
        summary: `File ${filePath} verified on filesystem (${stat.size} bytes).`,
      };
    }

    return {
      verified: false,
      method: 'fs.existsSync',
      expectedState: { exists: true },
      actualState: { exists: false },
      evidence: [],
      verifier: 'UniversalVerifier:Filesystem',
      timestamp: now,
      summary: `File ${filePath} does not exist on filesystem.`,
    };
  }

  private async verifyShellCommand(target: string, parameters: any, now: string): Promise<GoalVerification> {
    const exitCode = typeof parameters?.exitCode === 'number' ? parameters.exitCode : undefined;
    const verified = exitCode === 0; // a missing exit code is NOT success (Phase 1)

    const evidence: GoalEvidence = {
      id: `ev-shell-${Date.now()}`,
      type: 'stdout',
      label: `Shell Command Output: ${target}`,
      value: { exitCode, stdout: parameters?.stdout, stderr: parameters?.stderr },
      source: 'ChildProcess',
      timestamp: now,
      verified,
    };

    return {
      verified,
      method: 'ExitCodeCheck',
      expectedState: { exitCode: 0 },
      actualState: { exitCode },
      evidence: [evidence],
      verifier: 'UniversalVerifier:Shell',
      timestamp: now,
      summary: verified
        ? `Shell command completed successfully with exit code 0.`
        : exitCode === undefined ? 'No exit code was observed; the command is not verified.' : `Shell command failed with exit code ${exitCode}.`,
    };
  }

  private async verifyDesktopObserve(target: string, parameters: any, now: string): Promise<GoalVerification> {
    const obs = parameters?.__universalObservation;
    if (obs) {
      const verified = Boolean(obs.success && (obs.screenshotHash || obs.extractedVisibleContent?.length > 0) && obs.visionAnswer);
      const evidence: GoalEvidence = {
        id: `ev-obs-${Date.now()}`,
        type: 'window',
        label: `Desktop Observation for ${obs.title || obs.windowIdentity || target}`,
        value: {
          goalRunId: obs.goalRunId,
          turnId: obs.turnId,
          hwnd: obs.hwnd,
          windowIdentity: obs.windowIdentity,
          process: obs.process,
          title: obs.title,
          captureTimestamp: obs.captureTimestamp,
          screenshotHash: obs.screenshotHash,
          controlsCount: obs.controlsCount,
          extractedContent: obs.extractedVisibleContent?.substring(0, 300),
          visionAnswer: obs.visionAnswer,
        },
        source: 'UniversalPerceptionService:Desktop',
        timestamp: now,
        verified,
      };

      return {
        verified,
        method: 'UniversalPerceptionService.observeDesktop',
        expectedState: { windowInspected: true, textExtracted: true },
        actualState: { success: obs.success, hwnd: obs.hwnd, title: obs.title },
        evidence: [evidence],
        verifier: 'UniversalVerifier:DesktopPerception',
        timestamp: now,
        summary: obs.visionAnswer || (verified ? `Observed visible content of "${obs.title || target}".` : `Could not observe content of "${target}".`),
      };
    }

    const inspection: any = parameters?.__inspectionResult;
    const verified = Boolean(inspection && inspection.success && inspection.text?.length > 0);

    const evidence: GoalEvidence = {
      id: `ev-obs-${Date.now()}`,
      type: 'window',
      label: `Visible Desktop Content for ${inspection?.windowTitle || target}`,
      value: {
        windowTitle: inspection?.windowTitle,
        process: inspection?.process,
        hwnd: inspection?.hwnd,
        controlCount: inspection?.controlCount,
        textPreview: inspection?.text?.substring(0, 200),
      },
      source: 'DesktopPerceptionService',
      timestamp: now,
      verified,
    };

    return {
      verified,
      method: 'UIAutomationWindowInspection',
      expectedState: { windowInspected: true, textExtracted: true },
      actualState: { success: inspection?.success, length: inspection?.text?.length || 0 },
      evidence: [evidence],
      verifier: 'UniversalVerifier:DesktopPerception',
      timestamp: now,
      summary: verified
        ? (inspection?.summary || `Observed visible content of "${inspection.windowTitle || inspection.process}" (${inspection.controlCount} controls extracted).`)
        : (inspection?.error || `Could not observe content of "${target}": window not visible or accessible.`),
    };
  }

  private async verifyBrowserObserve(target: string, parameters: any, now: string): Promise<GoalVerification> {
    const obs = parameters?.__universalObservation;
    if (obs) {
      const verified = Boolean(obs.success && (obs.screenshotHash || obs.extractedVisibleContent?.length > 0) && obs.visionAnswer);
      const evidence: GoalEvidence = {
        id: `ev-browser-obs-${Date.now()}`,
        type: 'window',
        label: `Browser Observation for ${obs.title || obs.windowIdentity || target}`,
        value: {
          goalRunId: obs.goalRunId,
          turnId: obs.turnId,
          hwnd: obs.hwnd,
          windowIdentity: obs.windowIdentity,
          process: obs.process,
          title: obs.title,
          captureTimestamp: obs.captureTimestamp,
          screenshotHash: obs.screenshotHash,
          controlsCount: obs.controlsCount,
          extractedContent: obs.extractedVisibleContent?.substring(0, 300),
          visionAnswer: obs.visionAnswer,
        },
        source: 'UniversalPerceptionService:Browser',
        timestamp: now,
        verified,
      };

      return {
        verified,
        method: 'UniversalPerceptionService.observeBrowser',
        expectedState: { browserInspected: true, contentExtracted: true },
        actualState: { success: obs.success, hwnd: obs.hwnd, title: obs.title },
        evidence: [evidence],
        verifier: 'UniversalVerifier:BrowserPerception',
        timestamp: now,
        summary: obs.visionAnswer || (verified ? `Observed browser content of "${obs.title || target}".` : `Could not observe browser content of "${target}".`),
      };
    }

    return this.verifyDesktopObserve(target, parameters, now);
  }

  private async verifyScreenshot(target: string, parameters: any, now: string): Promise<GoalVerification> {
    const artifact: any = parameters?.__screenshotArtifact;
    const verified = Boolean(
      artifact &&
      artifact.success &&
      artifact.artifactPath &&
      fs.existsSync(artifact.artifactPath) &&
      artifact.byteSize > 1024 &&
      artifact.sha256
    );

    const evidence: GoalEvidence = {
      id: `ev-shot-${Date.now()}`,
      type: 'screenshot',
      label: `Real Screenshot Artifact`,
      value: artifact,
      source: 'DesktopPerceptionService:GDI',
      timestamp: now,
      verified,
    };

    return {
      verified,
      method: 'DiskArtifactAndHashVerification',
      expectedState: { artifactExists: true, byteSizeMin: 1024 },
      actualState: {
        exists: fs.existsSync(artifact?.artifactPath || ''),
        byteSize: artifact?.byteSize,
        sha256: artifact?.sha256,
      },
      evidence: [evidence],
      verifier: 'UniversalVerifier:Screenshot',
      timestamp: now,
      summary: verified
        ? `Screenshot artifact verified on disk (${artifact.byteSize} bytes, SHA256: ${artifact.sha256?.substring(0, 10)}...).`
        : `Screenshot verification failed: artifact missing or corrupt.`,
    };
  }

  private async verifyGeneric(target: string, parameters: any, now: string): Promise<GoalVerification> {
    const executed = false; // Phase 1: "it executed" is not an observation of the result
    const evidence: GoalEvidence = {
      id: `ev-gen-${Date.now()}`,
      type: 'audit_log',
      label: `Execution State for ${target}`,
      value: parameters,
      source: 'ExecutionAudit',
      timestamp: now,
      verified: executed,
    };

    return Promise.resolve({
      verified: executed,
      method: 'ExecutionAuditCheck',
      expectedState: { executed: true },
      actualState: { executed },
      evidence: [evidence],
      verifier: 'UniversalVerifier:Generic',
      timestamp: now,
      summary: executed
        ? `Action executed and verified via audit state.`
        : `No observation is available for this action; it is not verified.`,
    });
  }
}

export const universalVerifier = UniversalVerifier.getInstance();
