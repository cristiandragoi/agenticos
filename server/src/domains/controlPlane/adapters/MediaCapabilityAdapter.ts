/**
 * MediaCapabilityAdapter.ts — Provider-Abstracted Image Generation & Editing Capability
 *
 * Implements Section G:
 * - IMAGE_GENERATE and IMAGE_EDIT capabilities.
 * - Only configured real generation providers may produce production artifacts.
 * - Inputs: prompt, input ImageArtifactRef, dimensions/aspect, requested instructions.
 * - Outputs: typed ImageArtifactRef registered with ArtifactStore.
 * - Strictly verified: ensures file exists on disk and has non-zero byte size before returning verified.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../../../utils/logger.js';
import { artifactStore } from '../artifacts/ArtifactStore.js';
import type { ImageArtifactRef, ArtifactRef } from '../artifacts/types.js';
import { secretStore } from '../../../services/gateway/secretStore.js';
import type { ICapabilityAdapter } from './ICapabilityAdapter.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import type { ResolvedTargetEvidence } from '../TargetResolver.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';

export function inspectGeneratedImage(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}

export interface MediaGenerationRequest {
  readonly taskId: string;
  readonly prompt: string;
  readonly operation: 'IMAGE_GENERATE' | 'IMAGE_EDIT';
  readonly sourceImageArtifact?: ImageArtifactRef | ArtifactRef;
  readonly dimensions?: { width: number; height: number };
  readonly styleInstructions?: string;
  readonly negativePrompt?: string;
  readonly signal?: AbortSignal;
}

export interface IMediaGenerationProvider {
  readonly name: string;
  readonly supportsSourceImage?: boolean;
  isAvailable(): Promise<boolean>;
  generate(request: MediaGenerationRequest): Promise<{ success: boolean; imageBuffer?: Buffer; mimeType?: string; error?: string }>;
}

/**
 * Google GenAI / Gemini Imagen Provider
 */
class GeminiImagenProvider implements IMediaGenerationProvider {
  public readonly name = 'gemini_imagen';

  public async isAvailable(): Promise<boolean> {
    try {
      const key = (await secretStore.get('google')) || (await secretStore.get('gemini'));
      return Boolean(key);
    } catch {
      return false;
    }
  }

  public async generate(request: MediaGenerationRequest): Promise<{ success: boolean; imageBuffer?: Buffer; mimeType?: string; error?: string }> {
    const key = (await secretStore.get('google')) || (await secretStore.get('gemini'));
    if (!key) {
      return { success: false, error: 'Google Gemini API key not found in secretStore' };
    }

    try {
      // In production, invoke Gemini Imagen API endpoint:
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: `${request.prompt} ${request.styleInstructions || ''}`.trim() }],
          parameters: { sampleCount: 1, aspectRatio: '1:1', outputMimeType: 'image/jpeg' },
        }),
        signal: request.signal
          ? AbortSignal.any([request.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[GeminiImagenProvider] API returned ${res.status}:`, errText);
        return { success: false, error: `Imagen API error: ${res.status}` };
      }

      const data: any = await res.json();
      const b64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) {
        return { success: false, error: 'No image bytes returned from Imagen API' };
      }

      return {
        success: true,
        imageBuffer: Buffer.from(b64, 'base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err: any) {
      logger.warn(`[GeminiImagenProvider] Request error: ${err?.message}`);
      return { success: false, error: err?.message };
    }
  }
}

export class MediaCapabilityAdapter implements ICapabilityAdapter {
  public readonly id = 'media';
  public readonly supportedActions = ['IMAGE_GENERATE', 'IMAGE_EDIT'] as const;

  private static instance: MediaCapabilityAdapter;
  private providers: IMediaGenerationProvider[] = [
    new GeminiImagenProvider(),
  ];

  private constructor() {}

  public static getInstance(): MediaCapabilityAdapter {
    if (!MediaCapabilityAdapter.instance) {
      MediaCapabilityAdapter.instance = new MediaCapabilityAdapter();
    }
    return MediaCapabilityAdapter.instance;
  }

  public registerProvider(provider: IMediaGenerationProvider): void {
    this.providers.unshift(provider);
  }

  public async resolveTarget(
    intent: CompiledTurnIntent,
    context: AuthoritativeInteractionContextData
  ): Promise<ResolvedTargetEvidence> {
    return {
      requestedTarget: intent.target || intent.contentRequest || 'media_generator',
      targetHierarchy: { application: 'media_generator' },
      resolutionConfidence: 1.0,
      resolutionEvidence: { capability: 'media' },
      isExactMatch: true,
      matchType: 'installed_app',
    };
  }

  public async verify(
    executionResult: ExecutionStepResult,
    expectedTarget: ResolvedTargetEvidence
  ): Promise<{ isVerified: boolean; reason: string }> {
    const isVerified = executionResult.success && executionResult.verified;
    return {
      isVerified,
      reason: executionResult.failureReason || 'Verified media generation artifact',
    };
  }

  public async acquireContent(): Promise<any> {
    return { content: null, kind: 'NONE', error: 'MediaCapabilityAdapter does not acquire text content.' };
  }

  public async execute(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    resolvedTarget?: ResolvedTargetEvidence
  ): Promise<ExecutionStepResult> {
    const action = step.action as 'IMAGE_GENERATE' | 'IMAGE_EDIT';
    const prompt = step.contentRequest || step.rawPrompt || 'A cinematic advertisement';
    const taskId = String(stepId);

    // Look for input artifact reference in intent parameters if editing
    let inputArtifact: ArtifactRef | undefined;
    const inputArtifactId = (step as any).inputArtifactId;
    if (inputArtifactId) {
      inputArtifact = artifactStore.getArtifact(inputArtifactId);
    }

    const res = await this.generateImage({
      taskId,
      prompt,
      operation: action === 'IMAGE_EDIT' ? 'IMAGE_EDIT' : 'IMAGE_GENERATE',
      sourceImageArtifact: inputArtifact,
      styleInstructions: 'cinematic lighting, professional commercial advertisement, 8k resolution, photorealistic',
    });

    if (!res.success || !res.artifact) {
      return {
        stepId,
        action,
        requestedTarget: prompt,
        success: false,
        verified: false,
        failureReason: res.error || 'Image generation failed',
      };
    }

    return {
      stepId,
      action,
      requestedTarget: prompt,
      executedTarget: res.artifact.location,
      success: true,
      verified: true,
      verificationEvidence: {
        source: 'media_generator',
        label: `Generated ${action} artifact`,
        observedAt: Date.now(),
        data: {
          artifactId: res.artifact.artifactId,
          location: res.artifact.location,
          sha256: (res.artifact as any).metadata?.sha256,
          provider: res.providerUsed,
        },
      },
      contextMutation: {
        capability: 'MEDIA',
        summary: `Created advertisement artifact: ${res.artifact.artifactId}`,
      },
      outputText: 'The generated image is ready for you to review.',
    };
  }

  /**
   * Primary programmatic entry point for task graphs.
   */
  public async generateImage(request: MediaGenerationRequest): Promise<{
    success: boolean;
    artifact?: ImageArtifactRef;
    providerUsed?: string;
    error?: string;
  }> {
    let lastError: string | undefined;
    let eligibleProvider = false;

    for (const provider of this.providers) {
      try {
        if (request.signal?.aborted) return { success: false, error: 'Image generation cancelled by the user.' };
        const available = await provider.isAvailable();
        if (request.signal?.aborted) return { success: false, error: 'Image generation cancelled by the user.' };
        if (!available) continue;
        if (provider.name === 'local_synthetic_media') continue;
        if (request.sourceImageArtifact && !provider.supportsSourceImage) {
          lastError = 'The screenshot was saved, but no configured generator supports using the captured product image. No advertisement was created.';
          continue;
        }
        eligibleProvider = true;

        const res = await provider.generate(request);
        if (request.signal?.aborted) return { success: false, error: 'Image generation cancelled by the user.' };
        if (res.success && res.imageBuffer) {
          const dimensions = inspectGeneratedImage(res.imageBuffer);
          if (!dimensions || dimensions.width < 64 || dimensions.height < 64) {
            lastError = 'The generator returned an invalid or placeholder image. No completed artwork was verified.';
            continue;
          }
          const ext = res.mimeType === 'image/jpeg' ? '.jpg' : '.png';
          const saved = await artifactStore.storeFile({
            type: 'IMAGE',
            data: res.imageBuffer,
            extension: ext,
            mimeType: res.mimeType || 'image/png',
            createdByTaskId: request.taskId,
            metadata: {
              prompt: request.prompt,
              operation: request.operation,
              sourceArtifactId: request.sourceImageArtifact?.artifactId,
              provider: provider.name,
              width: dimensions.width,
              height: dimensions.height,
              verificationScope: 'image_header_dimensions_and_disk_persistence; visual quality requires review',
              styleInstructions: request.styleInstructions,
            },
            verified: true,
          });

          // Verify disk persistence
          const diskCheck = artifactStore.verifyArtifactOnDisk(saved.artifactId);
          if (!diskCheck.verified) {
            lastError = `Disk verification failed: ${diskCheck.error}`;
            continue;
          }

          const imageRef: ImageArtifactRef = {
            ...saved,
            type: 'IMAGE',
            dimensions,
            sha256: (saved.metadata as any)?.sha256,
          };

          return {
            success: true,
            artifact: imageRef,
            providerUsed: provider.name,
          };
        } else {
          lastError = res.error || 'Provider returned unsuccessful response';
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        logger.warn(`[MediaCapabilityAdapter] Provider ${provider.name} failed:`, lastError);
      }
    }

    return {
      success: false,
      error: lastError || (eligibleProvider ? 'All configured media providers failed.' : 'No real image generator is configured. Video creation, tool installation, and automatic login are not integrated; no advertisement was created.'),
    };
  }
}

export const mediaCapabilityAdapter = MediaCapabilityAdapter.getInstance();
