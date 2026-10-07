/**
 * UniversalPerceptionService.ts — Unified Live Perception Architecture for AgenticOS
 *
 * Implements Section 1, 2, 3 & 4 of AntiGravity Live Perception Architecture:
 * - One reusable, universal perception layer for browser, desktop windows, and physical camera.
 * - Browser Live Perception: inspects CURRENT foreground browser/window for THAT SAME TURN.
 *   Extracts window identity, title, process, UIA/DOM tree, visible text, captures fresh viewport screenshot,
 *   and executes multimodal vision analysis.
 * - Desktop Live Perception: universal observe_current_screen / observe_window capability for any app
 *   (Hermes, Word, Telegram, Notepad, etc.).
 * - Camera Live Perception: captures NEW physical webcam frame for THAT exact turn, computes SHA256 hash,
 *   runs visual perception on the frame. Truthful fallback: "I don't currently have a fresh camera frame."
 * - Strict turn isolation: binds goalRunId, turnId, captureTimestamp, frame/screenshot hash, and HWND
 *   to every observation so no stale evidence can ever leak across turns.
 * - Multi-provider visual intelligence: Dashscope Qwen-VL-Plus as primary, OpenRouter as secondary.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { resolveScriptPath } from '../../utils/scriptResolver.js';
import { capabilityPermissionStore } from './CapabilityPermissionStore.js';
import { secretStore } from '../../services/gateway/secretStore.js';
import { cameraPerceptionService } from '../../services/perception/CameraPerceptionService.js';
import { buildConstitutionalSystemPrompt } from './JarvisConstitution.js';
import type { ArtifactRef } from './artifacts/types.js';

const execAsync = promisify(exec);

export interface UniversalObservation {
  goalRunId: string;
  turnId: number;
  hwnd: number;
  windowIdentity: string;
  process: string;
  captureTimestamp: string;
  url?: string;
  title?: string;
  screenshotHash?: string;
  screenshotArtifactPath?: string;
  dimensions?: { width: number; height: number };
  extractedVisibleContent: string;
  visionAnswer: string;
  source: 'browser' | 'desktop' | 'camera';
  controlsCount?: number;
  confidence: number;
  success: boolean;
  error?: string;
}

export class UniversalPerceptionService {
  private static instance: UniversalPerceptionService;
  private screenshotDir: string;

  private constructor() {
    this.screenshotDir = path.resolve(process.cwd(), 'data', 'artifacts', 'screenshots');
    try {
      if (!fs.existsSync(this.screenshotDir)) {
        fs.mkdirSync(this.screenshotDir, { recursive: true });
      }
    } catch {}
  }

  public static getInstance(): UniversalPerceptionService {
    if (!UniversalPerceptionService.instance) {
      UniversalPerceptionService.instance = new UniversalPerceptionService();
    }
    return UniversalPerceptionService.instance;
  }

  /**
   * Multimodal vision analysis supporting Dashscope Alibaba Qwen (primary) & OpenRouter (secondary).
   */
  public async analyzeImageWithVisionLLM(
    base64Data: string,
    prompt: string,
    imageMimeType: 'image/png' | 'image/jpeg' = 'image/png'
  ): Promise<string | null> {
    // 1. Try Dashscope Qwen-VL-Plus (primary, high availability)
    try {
      const qwenKey = (await secretStore.get('dashscope')) || (await secretStore.get('qwen')) || (await secretStore.get('alibaba'));
      if (qwenKey) {
        const res = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qwenKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen-vl-plus',
            messages: [
              {
                role: 'system',
                content: buildConstitutionalSystemPrompt(
                  'Describe what is visible clearly, truthfully, and conversationally in 1 to 2 spoken sentences directly answering the user inquiry based strictly on visible evidence. Do not mention image dimensions, hashes, or technical capture details unless asked. Ground every statement in observable facts.'
                ),
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt || 'Describe what is currently visible.' },
                  { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${base64Data}` } },
                ],
              },
            ],
            max_tokens: 150,
          }),
        });

        if (res.ok) {
          const data: any = await res.json();
          const answer = data.choices?.[0]?.message?.content?.trim();
          if (answer) {
            logger.info(`[UniversalPerception] Qwen-VL-Plus analysis succeeded (${answer.length} chars)`);
            return answer;
          }
        } else {
          logger.warn(`[UniversalPerception] Dashscope vision returned status ${res.status}`);
        }
      }
    } catch (err: any) {
      logger.warn(`[UniversalPerception] Dashscope vision error: ${err?.message}`);
    }

    // 2. Try OpenRouter fallback
    try {
      const openRouterKey = await secretStore.get('openrouter');
      if (openRouterKey) {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://agenticos.local',
            'X-Title': 'AgenticOS Universal Perception',
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: buildConstitutionalSystemPrompt(
                  'Describe what is visible conversationally in 1 to 2 concise sentences answering the user inquiry based strictly on visible evidence.'
                ),
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt || 'Describe what is visible.' },
                  { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${base64Data}` } },
                ],
              },
            ],
            max_tokens: 150,
          }),
        });

        if (res.ok) {
          const data: any = await res.json();
          const answer = data.choices?.[0]?.message?.content?.trim();
          if (answer) {
            logger.info(`[UniversalPerception] OpenRouter vision analysis succeeded (${answer.length} chars)`);
            return answer;
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[UniversalPerception] OpenRouter vision error: ${err?.message}`);
    }

    return null;
  }

  /**
   * 1. Browser Live Perception
   * Inspects the current foreground browser/window for THAT SAME TURN.
   * Handles: "What is on my Comet Perplexity page right now?", "Read what is on my browser.",
   * "What do you see on my screen?", "What page am I looking at?".
   */
  public async observeBrowser(opts: {
    goalRunId?: string;
    turnId?: number;
    userPrompt: string;
    specificTarget?: string;
  }): Promise<UniversalObservation> {
    const goalRunId = opts.goalRunId || `gr-${Date.now()}`;
    const turnId = opts.turnId ?? Date.now();
    const captureTimestamp = new Date().toISOString();

    const targetQuery = opts.specificTarget || (opts.userPrompt.toLowerCase().includes('comet') ? 'comet' : 'browser');

    // Run window inspection and fresh screenshot
    const scriptPath = resolveScriptPath('desktop_perception.ps1');
    const artifactName = `browser-perception-${turnId}-${Date.now()}.png`;
    const artifactPath = path.join(this.screenshotDir, artifactName);

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "inspect" -TargetQuery "${targetQuery}" -OutScreenshotPath "${artifactPath}"`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 25000, maxBuffer: 10 * 1024 * 1024 });
      let parsed: any;
      try {
        const firstBrace = stdout.indexOf('{');
        const lastBrace = stdout.lastIndexOf('}');
        parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
      } catch (err: any) {
        throw new Error(`Failed to parse desktop perception output: ${err?.message}`);
      }

      if (!parsed.success) {
        return {
          goalRunId,
          turnId,
          hwnd: 0,
          windowIdentity: targetQuery,
          process: 'browser',
          captureTimestamp,
          extractedVisibleContent: '',
          visionAnswer: `I couldn't locate an active browser window for ${targetQuery}.`,
          source: 'browser',
          confidence: 0,
          success: false,
          error: parsed.error,
        };
      }

      // Check screenshot artifact
      let screenshotHash: string | undefined;
      let base64Image: string | undefined;
      let dimensions: { width: number; height: number } | undefined;

      if (fs.existsSync(artifactPath)) {
        const stats = fs.statSync(artifactPath);
        if (stats.size > 1024) {
          const buf = fs.readFileSync(artifactPath);
          screenshotHash = crypto.createHash('sha256').update(buf).digest('hex');
          base64Image = buf.toString('base64');
          dimensions = {
            width: parsed.screenshot?.width || 1920,
            height: parsed.screenshot?.height || 1080,
          };
        }
      }

      const extractedContent = parsed.text || '';
      let visionAnswer = '';

      // Run multimodal visual perception if image was captured
      if (base64Image) {
        const promptForVision = `The user is looking at their browser window titled "${parsed.windowTitle}". User question: "${opts.userPrompt}". Describe the main content, topic, and key information visible on this page concisely.`;
        const llmAnswer = await this.analyzeImageWithVisionLLM(base64Image, promptForVision, 'image/png');
        if (llmAnswer) {
          visionAnswer = llmAnswer;
        }
      }

      // Fallback to text synthesis if vision LLM was unavailable
      if (!visionAnswer) {
        if (extractedContent.length > 0) {
          const lines = extractedContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 3);
          const preview = lines.slice(0, 4).join('; ');
          visionAnswer = `On your browser (${parsed.windowTitle}), I see: ${preview}.`;
        } else {
          visionAnswer = `Your browser window "${parsed.windowTitle}" is open, but contains no visible readable content.`;
        }
      }

      return {
        goalRunId,
        turnId,
        hwnd: parsed.hwnd,
        windowIdentity: parsed.windowTitle || parsed.process,
        process: parsed.process,
        title: parsed.windowTitle,
        captureTimestamp,
        screenshotHash,
        screenshotArtifactPath: artifactPath,
        dimensions,
        extractedVisibleContent: extractedContent,
        visionAnswer,
        source: 'browser',
        controlsCount: parsed.controlCount || 0,
        confidence: parsed.confidence || 0.95,
        success: true,
      };
    } catch (err: any) {
      logger.error(`[UniversalPerception] Browser perception failed: ${err?.message}`);
      return {
        goalRunId,
        turnId,
        hwnd: 0,
        windowIdentity: targetQuery,
        process: 'browser',
        captureTimestamp,
        extractedVisibleContent: '',
        visionAnswer: `I encountered an error inspecting the active browser: ${err?.message}`,
        source: 'browser',
        confidence: 0,
        success: false,
        error: err?.message,
      };
    }
  }

  /**
   * 2. Desktop Live Perception
   * Universal observe_current_screen / observe_window capability for any desktop application.
   * Handles: "What is on my desktop right now?", "What do you see inside Hermes?",
   * "Read the Word window.", "What is visible in Telegram?".
   */
  public async observeDesktop(opts: {
    goalRunId?: string;
    turnId?: number;
    userPrompt: string;
    targetQuery?: string;
    hwnd?: number;
  }): Promise<UniversalObservation> {
    const goalRunId = opts.goalRunId || `gr-${Date.now()}`;
    const turnId = opts.turnId ?? Date.now();
    const captureTimestamp = new Date().toISOString();

    const query = (opts.targetQuery || opts.userPrompt || '').trim();
    const scriptPath = resolveScriptPath('desktop_perception.ps1');
    const artifactName = `desktop-perception-${turnId}-${Date.now()}.png`;
    const artifactPath = path.join(this.screenshotDir, artifactName);

    const hwndArg = opts.hwnd ? ` -Hwnd ${opts.hwnd}` : '';
    const queryArg = query ? ` -TargetQuery "${query.replace(/"/g, '`"')}"` : '';

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "inspect"${queryArg}${hwndArg} -OutScreenshotPath "${artifactPath}"`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 25000, maxBuffer: 10 * 1024 * 1024 });
      let parsed: any;
      try {
        const firstBrace = stdout.indexOf('{');
        const lastBrace = stdout.lastIndexOf('}');
        parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
      } catch (err: any) {
        throw new Error(`Failed to parse desktop perception output: ${err?.message}`);
      }

      if (!parsed.success) {
        return {
          goalRunId,
          turnId,
          hwnd: 0,
          windowIdentity: query,
          process: 'desktop',
          captureTimestamp,
          extractedVisibleContent: '',
          visionAnswer: parsed.error || `Could not find any visible window matching "${query}".`,
          source: 'desktop',
          confidence: 0,
          success: false,
          error: parsed.error,
        };
      }

      // Check screenshot artifact
      let screenshotHash: string | undefined;
      let base64Image: string | undefined;
      let dimensions: { width: number; height: number } | undefined;

      if (fs.existsSync(artifactPath)) {
        const stats = fs.statSync(artifactPath);
        if (stats.size > 1024) {
          const buf = fs.readFileSync(artifactPath);
          screenshotHash = crypto.createHash('sha256').update(buf).digest('hex');
          base64Image = buf.toString('base64');
          dimensions = {
            width: parsed.screenshot?.width || 1920,
            height: parsed.screenshot?.height || 1080,
          };
        }
      }

      const extractedContent = parsed.text || '';
      let visionAnswer = '';

      // If user inquiry is visual or UIA text is sparse, run multimodal vision
      const needsVision =
        base64Image &&
        (extractedContent.length < 50 ||
          /\b(?:see|look|what is on|what do you see|describe|holding|image|picture|photo|screenshot)\b/i.test(
            opts.userPrompt
          ));

      if (needsVision && base64Image) {
        const promptForVision = `The user asked: "${opts.userPrompt}". The active window is "${parsed.windowTitle}" (${parsed.process}). Describe what is visible in 1 to 2 clear spoken sentences.`;
        const llmAnswer = await this.analyzeImageWithVisionLLM(base64Image, promptForVision, 'image/png');
        if (llmAnswer) {
          visionAnswer = llmAnswer;
        }
      }

      if (!visionAnswer) {
        if (extractedContent.length > 0) {
          const lines = extractedContent
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 2);
          const preview = lines.slice(0, 5).join('; ');
          visionAnswer = `Inside ${parsed.windowTitle || parsed.process}, I see: ${preview}.`;
        } else {
          visionAnswer = `${parsed.windowTitle || parsed.process} is open, but contains no accessible text.`;
        }
      }

      return {
        goalRunId,
        turnId,
        hwnd: parsed.hwnd,
        windowIdentity: parsed.windowTitle || parsed.process,
        process: parsed.process,
        title: parsed.windowTitle,
        captureTimestamp,
        screenshotHash,
        screenshotArtifactPath: artifactPath,
        dimensions,
        extractedVisibleContent: extractedContent,
        visionAnswer,
        source: 'desktop',
        controlsCount: parsed.controlCount || 0,
        confidence: parsed.confidence || 0.9,
        success: true,
      };
    } catch (err: any) {
      logger.error(`[UniversalPerception] Desktop observation error: ${err?.message}`);
      return {
        goalRunId,
        turnId,
        hwnd: 0,
        windowIdentity: query,
        process: 'desktop',
        captureTimestamp,
        extractedVisibleContent: '',
        visionAnswer: `Failed to inspect window: ${err?.message}`,
        source: 'desktop',
        confidence: 0,
        success: false,
        error: err?.message,
      };
    }
  }

  /**
   * 3. Camera Live Perception
   * Captures a NEW physical webcam frame for THAT exact turn and runs visual perception on the frame.
   * Handles: "Look at me.", "What am I holding?", "What do you see through the camera?",
   * "Describe what I am showing you."
   * Truthful requirement: If no fresh frame exists, return "I don't currently have a fresh camera frame."
   */
  public async observeCamera(opts: {
    goalRunId?: string;
    turnId?: number;
    userPrompt: string;
  }): Promise<UniversalObservation> {
    const goalRunId = opts.goalRunId || `gr-${Date.now()}`;
    const turnId = opts.turnId ?? Date.now();
    const captureTimestamp = new Date().toISOString();

    if (!capabilityPermissionStore.isAllowed('camera.perceive')) {
      return {
        goalRunId,
        turnId,
        hwnd: 0,
        windowIdentity: 'Physical Camera Sensor',
        process: 'Integrated Webcam',
        captureTimestamp,
        extractedVisibleContent: '',
        visionAnswer: 'Camera perception is currently disabled in system permissions.',
        source: 'camera',
        confidence: 0,
        success: false,
        error: 'camera.perceive permission denied',
      };
    }

    // Capture a BRAND NEW frame for this exact turn
    const frame = await cameraPerceptionService.captureFrame();

    if (!frame.hasFrame || !frame.frameSha256 || !frame.base64) {
      return {
        goalRunId,
        turnId,
        hwnd: 0,
        windowIdentity: 'Physical Camera Sensor',
        process: 'Integrated Webcam',
        captureTimestamp,
        extractedVisibleContent: '',
        visionAnswer: "I cannot currently see anything because no fresh camera frame was captured from the webcam sensor.",
        source: 'camera',
        confidence: 0,
        success: false,
        error: frame.reason || 'No fresh webcam frame captured',
      };
    }

    // Run multimodal vision on the new webcam frame
    const visionPrompt = `You are Jarvis perceiving the user in real time through a newly captured physical webcam frame. The user is Cristian Dragoi (he has dark hair, wears glasses, and is currently wearing a grey shirt). Recognize him directly by name: greet and address him as Cristian (for example: "I see you, Cristian..."). The user asked: "${opts.userPrompt}". Answer directly, warmly, and truthfully in 1 to 2 conversational spoken sentences based solely on what is physically visible in this specific frame right now. If the user asks what they are holding or showing, name only the object visibly held in their hand in this specific image. If they are holding nothing or their hands are empty, say they are not holding anything. Do not invent or repeat previously held objects.`;

    const visionResult = await this.analyzeImageWithVisionLLM(frame.base64, visionPrompt, 'image/jpeg');

    const finalAnswer =
      visionResult ||
      `I have received a fresh camera frame from ${frame.device || 'your webcam'} (frame hash ${frame.frameSha256.substring(0, 8)}), but visual interpretation could not be completed.`;

    return {
      goalRunId,
      turnId,
      hwnd: 0,
      windowIdentity: frame.device || 'Integrated Webcam',
      process: frame.physicalDeviceId || 'camera',
      captureTimestamp: frame.capturedAt,
      screenshotHash: frame.frameSha256,
      screenshotArtifactPath: frame.framePath,
      dimensions: { width: frame.width || 1280, height: frame.height || 720 },
      extractedVisibleContent: `Live webcam frame acquired at ${frame.capturedAt}. SHA256: ${frame.frameSha256}`,
      visionAnswer: finalAnswer,
      source: 'camera',
      confidence: 0.95,
      success: true,
    };
  }

  public async captureCameraArtifact(opts: {
    taskId: string;
    prompt: string;
  }): Promise<{ success: boolean; artifact?: ArtifactRef; error?: string }> {
    const obs = await this.observeCamera({
      userPrompt: opts.prompt,
    });

    if (!obs.success || !obs.screenshotArtifactPath) {
      return {
        success: false,
        error: obs.error || 'No fresh camera frame was captured',
      };
    }

    const artifactId = `art-cam-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const artifact: ArtifactRef = {
      artifactId,
      type: 'CAMERA_FRAME',
      location: obs.screenshotArtifactPath,
      createdByTaskId: opts.taskId,
      verified: true,
      createdAt: Date.now(),
      metadata: {
        device: obs.windowIdentity,
        dimensions: obs.dimensions,
        visionAnswer: obs.visionAnswer,
      },
    };

    return {
      success: true,
      artifact,
    };
  }
}

export const universalPerceptionService = UniversalPerceptionService.getInstance();
