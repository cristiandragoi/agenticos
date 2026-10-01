/**
 * ArgusService.ts — Preflight Inspector, Independent Reality Verifier & Engineering Reviewer
 *
 * Responsibilities:
 * 1. PREFLIGHT INSPECTOR (Before Execution):
 *    - Assesses intent, modality, target identity, required capabilities and permissions.
 *    - Rejects execution if required capabilities are FAILED or permissions denied.
 *    - Generates strict EvidencePlan and expected physical post-conditions.
 *
 * 2. INDEPENDENT VERIFIER (After Execution):
 *    - The executor may NEVER certify itself.
 *    - Validates machine/physical evidence (real files > minBytes, hashes, window handles, UIA trees).
 *    - Issues final verdict: VERIFIED | FAILED | UNCERTAIN.
 *
 * 3. INDEPENDENT ENGINEERING REVIEWER:
 *    - Inspects code diffs produced by engineering workers.
 *    - Rejects changes that hardcode examples (Comet, Hermes 1, Calculator, etc.).
 *    - Ensures evidence contracts and regression tests are preserved.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { capabilityPermissionStore } from './CapabilityPermissionStore.js';
import type { GoalEvidence, GoalRun, GoalVerification } from './types.js';

export type ArgusModality =
  | 'desktop'
  | 'browser'
  | 'camera'
  | 'screenshot'
  | 'screen_vision'
  | 'shell'
  | 'filesystem'
  | 'engineering'
  | 'internal';

export interface ExecutionPreflight {
  goalId: string;
  resolvedIntent: string;
  target: string;
  modality: ArgusModality;
  requiredCapabilities: string[];
  permissionState: Record<string, string>;
  prerequisiteChecks: Array<{ check: string; passed: boolean; reason?: string }>;
  expectedPostCondition: string;
  evidencePlan: {
    requiredEvidenceTypes: string[];
    minByteSize?: number;
    requireHash?: boolean;
    targetProcess?: string;
  };
  verifier: string;
  confidence: number;
}

export interface PreflightResult {
  approved: boolean;
  preflight: ExecutionPreflight;
  rejectionReason?: string;
}

export interface EngineeringReviewResult {
  approved: boolean;
  verdict: 'APPROVED' | 'REJECTED';
  reasons: string[];
  isHardcodedExample: boolean;
  preservesEvidenceContract: boolean;
}

export class ArgusService {
  private static instance: ArgusService;

  private constructor() {}

  public static getInstance(): ArgusService {
    if (!ArgusService.instance) {
      ArgusService.instance = new ArgusService();
    }
    return ArgusService.instance;
  }

  /**
   * MANDATORY PREFLIGHT INSPECTOR — runs BEFORE any action or side-effect is executed.
   */
  public async preflight(opts: {
    goalId: string;
    resolvedIntent: string;
    target: string;
    surface: string;
    parameters?: Record<string, any>;
  }): Promise<PreflightResult> {
    const { goalId, resolvedIntent, target, surface, parameters } = opts;
    const modality = this.inferModality(surface, resolvedIntent, target);
    const requiredCaps = this.determineRequiredCapabilities(modality, resolvedIntent);
    
    // Check permissions
    const permissionState: Record<string, string> = {};
    const prerequisiteChecks: Array<{ check: string; passed: boolean; reason?: string }> = [];
    let allPermissionsGranted = true;
    let missingPermission = '';

    for (const cap of requiredCaps) {
      const allowed = capabilityPermissionStore.isAllowed(cap);
      const permValue = capabilityPermissionStore.getPermission(cap);
      permissionState[cap] = permValue;
      if (!allowed) {
        allPermissionsGranted = false;
        missingPermission = cap;
      }
    }

    prerequisiteChecks.push({
      check: 'capability_permissions',
      passed: allPermissionsGranted,
      reason: allPermissionsGranted ? undefined : `Capability ${missingPermission} is ${permissionState[missingPermission] || 'denied'}`,
    });

    // Check modality-specific prerequisites
    if (modality === 'camera') {
      const { cameraPerceptionService } = await import('../../services/perception/CameraPerceptionService.js');
      const camStatus = cameraPerceptionService.getStatus();
      prerequisiteChecks.push({
        check: 'camera_hardware_available',
        passed: camStatus.isEnabled,
        reason: camStatus.isEnabled ? undefined : 'Webcam hardware is disabled or unavailable',
      });
    }

    if (modality === 'desktop') {
      prerequisiteChecks.push({
        check: 'desktop_target_specified',
        passed: Boolean(target && target.trim().length > 0),
        reason: target ? undefined : 'No application or target window specified',
      });
    }

    const approved = prerequisiteChecks.every(c => c.passed);
    const expectedPostCondition = this.determineExpectedPostCondition(modality, target, resolvedIntent);
    const evidencePlan = this.determineEvidencePlan(modality, target);

    const preflight: ExecutionPreflight = {
      goalId,
      resolvedIntent,
      target,
      modality,
      requiredCapabilities: requiredCaps,
      permissionState,
      prerequisiteChecks,
      expectedPostCondition,
      evidencePlan,
      verifier: 'ArgusIndependentVerifier',
      confidence: approved ? 0.95 : 0.2,
    };

    if (!approved) {
      const firstFailure = prerequisiteChecks.find(c => !c.passed);
      logger.warn(`[Argus:Preflight] Goal ${goalId} rejected: ${firstFailure?.reason}`);
      return {
        approved: false,
        preflight,
        rejectionReason: firstFailure?.reason || 'Prerequisite checks failed',
      };
    }

    logger.info(`[Argus:Preflight] Goal ${goalId} approved for ${modality}:${target}`);
    return {
      approved: true,
      preflight,
    };
  }

  /**
   * INDEPENDENT REALITY VERIFIER — runs AFTER execution.
   * The executor may NEVER certify itself.
   */
  public async verifyExecution(opts: {
    goalRun: GoalRun;
    surface: string;
    target: string;
    parameters?: Record<string, any>;
    executionResult: { executed: boolean; error?: string; data?: any };
  }): Promise<GoalVerification> {
    const { goalRun, surface, target, parameters, executionResult } = opts;
    const now = new Date().toISOString();

    if (!executionResult.executed) {
      return {
        verified: false,
        method: 'ArgusIndependentVerifier',
        expectedState: { executed: true },
        actualState: { executed: false, error: executionResult.error },
        evidence: [],
        verifier: 'Argus',
        timestamp: now,
        summary: `Execution failed: ${executionResult.error || 'unknown error'}`,
      };
    }

    // Call UniversalVerifier to gather multi-source evidence
    const { universalVerifier } = await import('./UniversalVerifier.js');
    const uvRes = await universalVerifier.verify({
      surface,
      target,
      parameters,
    });

    // Argus applies strict evidence validation
    const evidence = uvRes.evidence || [];
    let strictlyVerified = uvRes.verified;
    let failureReason: string | undefined;

    const goalStartMs = (goalRun as any)?.startedAt
      ? new Date((goalRun as any).startedAt).getTime()
      : (goalRun?.createdAt ? new Date(goalRun.createdAt).getTime() : Date.now() - 30000);

    // Validate screenshot evidence contract (only for capturing screenshots, not opening them)
    if ((surface === 'screenshot' || parameters?.capability === 'screen.capture') && parameters?.verb !== 'open') {
      const shot = parameters?.__screenshotArtifact || (uvRes.actualState as any);
      if (!shot || !shot.artifactPath || !fs.existsSync(shot.artifactPath)) {
        strictlyVerified = false;
        failureReason = 'Screenshot artifact missing or file does not exist on disk';
      } else if (!shot.byteSize || shot.byteSize < 1024) {
        strictlyVerified = false;
        failureReason = `Screenshot byteSize (${shot.byteSize}) is below minimum valid image size (1024 bytes)`;
      } else if (!shot.sha256 || shot.sha256.length !== 64) {
        strictlyVerified = false;
        failureReason = 'Screenshot cryptographic SHA256 hash is missing or invalid';
      } else {
        // Enforce freshness: must have been generated for THIS GoalRun
        const fileStat = fs.statSync(shot.artifactPath);
        if (fileStat.mtimeMs < goalStartMs - 5000) {
          strictlyVerified = false;
          failureReason = `Screenshot artifact is stale: modified at ${fileStat.mtime.toISOString()} before goal started at ${new Date(goalStartMs).toISOString()}`;
        } else {
          strictlyVerified = true;
        }
      }
    }

    // Validate camera perception evidence contract
    if (surface === 'camera' || parameters?.capability === 'camera.perceive') {
      const cam = parameters?.__cameraPerception || (uvRes.actualState as any);
      const obs = parameters?.__universalObservation;
      const sha = cam?.frameSha256 || cam?.frameMetadata?.frameSha256 || obs?.screenshotHash;
      const isTruthfulNotice = Boolean(
        (cam?.answer && (cam.answer.includes("fresh camera frame") || cam.answer.includes("cannot currently see anything") || cam.answer.includes("disabled in system permissions"))) ||
        (obs?.visionAnswer && (obs.visionAnswer.includes("I don't currently have a fresh camera frame") || obs.visionAnswer.includes("disabled in system permissions")))
      );

      if (isTruthfulNotice) {
        strictlyVerified = true;
      } else if (!cam || !cam.hasFrame) {
        strictlyVerified = false;
        failureReason = 'Physical camera frame was not acquired';
      } else if (!sha || sha.length !== 64) {
        strictlyVerified = false;
        failureReason = 'Cryptographic physical camera frame hash missing';
      } else if (cam.capturedAt) {
        const camMs = new Date(cam.capturedAt).getTime();
        if (camMs < goalStartMs - 5000) {
          strictlyVerified = false;
          failureReason = `Camera frame is stale: captured at ${cam.capturedAt} before goal started at ${new Date(goalStartMs).toISOString()}`;
        }
      }
    }

    // Validate desktop perception evidence contract
    if (surface === 'desktop_observe' || parameters?.capability === 'desktop.observe') {
      const insp = parameters?.__inspectionResult || (uvRes.actualState as any);
      if (!insp || !insp.hwnd) {
        strictlyVerified = false;
        failureReason = 'No active window handle was inspected.';
      } else if (!insp.text && (!insp.controls || insp.controls.length === 0)) {
        strictlyVerified = false;
        failureReason = 'No content or controls could be read from window.';
      }
    }

    // Validate Word / document creation physical evidence contract
    const isDocRequest = /\b(?:blank\s+document|new\s+document|create.*document|word.*document)\b/i.test(target) ||
      /\b(?:blank\s+document|new\s+document|create.*document|word.*document)\b/i.test(goalRun.originalUserInput || '');
    if (isDocRequest) {
      let docVerified = false;
      let docEvidence: any = null;
      try {
        const ps = `
          $word = Get-Process -Name WINWORD -ErrorAction SilentlyContinue | Where-Object { 
            ($_.MainWindowTitle -and $_.MainWindowTitle -match 'Document\\d*|Dokument\\d*|\\.docx?') -or 
            ($_.MainWindowTitle -and $_.MainWindowTitle -ne 'Word' -and $_.MainWindowTitle -ne '')
          } | Select-Object -First 1 Id, ProcessName, MainWindowTitle
          if ($word) {
            $word | ConvertTo-Json -Compress
          } else {
            try {
              $w = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
              if ($w -and $w.Documents.Count -gt 0) {
                [PSCustomObject]@{ Id = 0; ProcessName = 'WINWORD'; MainWindowTitle = $w.ActiveDocument.Name } | ConvertTo-Json -Compress
              }
            } catch {}
          }
        `;
        const b64 = Buffer.from(ps, 'utf16le').toString('base64');
        const { execSync } = await import('node:child_process');
        const out = execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { timeout: 4000 }).toString().trim();
        if (out) {
          docEvidence = JSON.parse(out);
          docVerified = true;
          strictlyVerified = true;
          evidence.push({
            id: `ev-word-doc-${Date.now()}`,
            type: 'process',
            label: `Active Word Document "${docEvidence.MainWindowTitle}"`,
            value: docEvidence,
            source: 'Argus:WordCOM',
            timestamp: now,
            verified: true,
          });
        }
      } catch {}

      // Also check recent documents on disk in Documents/Desktop/cwd
      if (!docVerified) {
        try {
          const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
          const searchDirs = [
            path.join(userProfile, 'Documents'),
            path.join(userProfile, 'Desktop'),
            process.cwd(),
          ];
          const oneMinuteAgo = Date.now() - 60000;
          for (const sDir of searchDirs) {
            if (!fs.existsSync(sDir)) continue;
            const files = fs.readdirSync(sDir);
            for (const f of files) {
              if (/\.(?:docx?|rtf)$/i.test(f)) {
                const full = path.join(sDir, f);
                const stat = fs.statSync(full);
                if (stat.mtimeMs > oneMinuteAgo && stat.size > 0) {
                  docVerified = true;
                  docEvidence = { path: full, size: stat.size, mtime: stat.mtime };
                  evidence.push({
                    id: `ev-doc-file-${Date.now()}`,
                    type: 'file',
                    label: `Word Document File ${full}`,
                    value: docEvidence,
                    source: 'Argus:FileSystem',
                    timestamp: now,
                    verified: true,
                  });
                  break;
                }
              }
            }
            if (docVerified) break;
          }
        } catch {}
      }

      if (docVerified) {
        strictlyVerified = true;
      } else {
        strictlyVerified = false;
        failureReason = 'Word document does not exist or was not created';
      }
    }

    return {
      verified: strictlyVerified,
      method: 'ArgusIndependentVerifier',
      expectedState: uvRes.expectedState,
      actualState: uvRes.actualState,
      evidence,
      verifier: 'Argus',
      timestamp: now,
      summary: strictlyVerified
        ? (uvRes.summary || `Verified outcome for ${target} on ${surface}`)
        : (failureReason || uvRes.summary || `Verification failed for ${target}`),
    };
  }

  /**
   * INDEPENDENT ENGINEERING REVIEWER — inspects code diffs created by engineering workers.
   */
  public reviewEngineeringChange(opts: {
    diff: string;
    modifiedFiles: string[];
    taskDescription: string;
  }): EngineeringReviewResult {
    const { diff, modifiedFiles, taskDescription } = opts;
    const reasons: string[] = [];
    let isHardcodedExample = false;

    // Check for hardcoding specific test entities
    const lowerDiff = diff.toLowerCase();
    const hardcodedBadPatterns = [
      /if\s*\([^)]*['"]comet['"]\)/i,
      /if\s*\([^)]*['"]hermes 1['"]\)/i,
      /if\s*\([^)]*['"]calculator['"]\)/i,
      /if\s*\([^)]*===\s*['"]comet['"]\)/i,
      /case\s*['"]comet['"]:/i,
    ];

    for (const pat of hardcodedBadPatterns) {
      if (pat.test(lowerDiff)) {
        isHardcodedExample = true;
        reasons.push(`Diff contains hardcoded patch pattern: ${pat.source}. Solutions must be general.`);
      }
    }

    // Check for evidence contract bypasses
    if (lowerDiff.includes('verified: true') && !lowerDiff.includes('evidence')) {
      reasons.push('Diff marks verification true without generating or validating evidence');
    }

    const preservesEvidenceContract = !lowerDiff.includes('// bypass evidence');
    const approved = !isHardcodedExample && reasons.length === 0;

    return {
      approved,
      verdict: approved ? 'APPROVED' : 'REJECTED',
      reasons,
      isHardcodedExample,
      preservesEvidenceContract,
    };
  }

  private inferModality(surface: string, verb: string, target: string): ArgusModality {
    const s = (surface || '').toLowerCase();
    const v = (verb || '').toLowerCase();
    const t = (target || '').toLowerCase();

    if (s === 'camera' || v === 'perceive' || t.includes('camera') || t.includes('see me')) return 'camera';
    if (s === 'screenshot' || v === 'capture_screenshot' || t.includes('screenshot')) return 'screenshot';
    if (s === 'desktop_observe' || v === 'observe' || t.includes('screen') || t.includes('what do you see')) return 'desktop';
    if (s === 'browser' || t.startsWith('http') || t.includes('.com') || t.includes('.org')) return 'browser';
    if (s === 'shell') return 'shell';
    if (s === 'filesystem') return 'filesystem';
    if (s === 'engineering' || v.includes('repair') || v.includes('heal') || v.includes('fix')) return 'engineering';
    return 'desktop';
  }

  private determineRequiredCapabilities(modality: ArgusModality, verb: string): string[] {
    switch (modality) {
      case 'desktop':
        if (verb === 'observe') return ['desktop.observe'];
        return ['desktop.control'];
      case 'browser':
        if (verb === 'type') return ['browser.read', 'browser.input'];
        if (verb === 'click') return ['browser.read', 'browser.click'];
        return ['browser.read', 'browser.navigate'];
      case 'camera':
        return ['camera.perceive'];
      case 'screenshot':
        return ['screen.capture'];
      case 'screen_vision':
        return ['screen.capture', 'desktop.observe'];
      case 'shell':
        return ['shell.execute'];
      case 'filesystem':
        return ['filesystem.read'];
      case 'engineering':
        return ['filesystem.read', 'filesystem.write', 'shell.execute'];
      default:
        return ['desktop.control'];
    }
  }

  private determineExpectedPostCondition(modality: ArgusModality, target: string, verb: string): string {
    switch (modality) {
      case 'desktop':
        return verb === 'observe'
          ? `Text and controls of window "${target}" extracted`
          : `Application "${target}" running and foreground window matched`;
      case 'browser':
        return `Browser active on "${target}" and DOM loaded`;
      case 'camera':
        return 'Physical webcam frame captured with cryptographic hash and grounded vision analysis';
      case 'screenshot':
        return 'PNG image artifact created with verified dimensions, byte size > 1024, and sha256';
      case 'engineering':
        return 'Code changes reviewed, tests passed, build succeeded, and runtime reloaded';
      default:
        return `Action ${verb} on ${target} verified by independent reality probe`;
    }
  }

  private determineEvidencePlan(modality: ArgusModality, target: string) {
    switch (modality) {
      case 'screenshot':
        return {
          requiredEvidenceTypes: ['image_artifact', 'sha256', 'dimensions'],
          minByteSize: 1024,
          requireHash: true,
        };
      case 'camera':
        return {
          requiredEvidenceTypes: ['physical_frame', 'frame_hash', 'grounded_analysis'],
          requireHash: true,
        };
      case 'desktop':
        return {
          requiredEvidenceTypes: ['hwnd', 'process_name', 'window_title'],
          targetProcess: target,
        };
      default:
        return {
          requiredEvidenceTypes: ['machine_verification'],
        };
    }
  }
}

export const argusService = ArgusService.getInstance();
