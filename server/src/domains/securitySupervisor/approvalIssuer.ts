/**
 * domains/securitySupervisor/approvalIssuer.ts
 *
 * Out-of-process human approval issuer implementation per APPROVAL-DESIGN.md.
 * Holds ECDSA P-256 private key and enforces interactive human presence checks.
 * In production, the real Windows presence prompt is UNIMPLEMENTED (fails closed)
 * until explicit operator enrollment. Tests use TestDoublePresenceProvider.
 */

import {
  type KeyObject,
  sign,
  createHash,
} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  canonical,
  approvalHash,
  type ApprovalBinding,
  type ApprovalPayload,
  type SignedApprovalEnvelope,
} from './approvalVerifier.js';

export interface HumanPresenceChallenge {
  operation: string;
  tool: string;
  preview: string;
  nonce: string;
  runtimeIncarnation: string;
  requestedAt: number;
}

export interface IHumanPresenceProvider {
  verifyPresence(challenge: HumanPresenceChallenge): Promise<boolean>;
}

/**
 * Default production provider: fail closed.
 * The real Windows Hello / CredUI secure prompt remains UNIMPLEMENTED
 * for the user to enroll later via persistent CNG credentials.
 */
export class UnenrolledWindowsPresenceProvider implements IHumanPresenceProvider {
  async verifyPresence(_challenge: HumanPresenceChallenge): Promise<boolean> {
    throw new Error('HUMAN_PRESENCE_UNENROLLED: Real Windows presence prompt is not yet enrolled; operator enrollment required.');
  }
}

/**
 * Test double presence provider for automated unit tests.
 */
export class TestDoublePresenceProvider implements IHumanPresenceProvider {
  private approved: boolean;

  constructor(initialApproved = true) {
    this.approved = initialApproved;
  }

  setApproved(value: boolean): void {
    this.approved = value;
  }

  async verifyPresence(_challenge: HumanPresenceChallenge): Promise<boolean> {
    return this.approved;
  }
}

export interface IssuerManifestConfig {
  manifestPath?: string;
  ownerSid?: string;
  permissions?: string;
  isInteractiveSession?: boolean;
}

export class OutOfProcessApprovalIssuer {
  private isInteractiveSession: boolean;

  constructor(
    private privateKey: KeyObject,
    private presenceProvider: IHumanPresenceProvider = new UnenrolledWindowsPresenceProvider(),
    private manifestConfig?: IssuerManifestConfig,
  ) {
    if (!privateKey || privateKey.type !== 'private') {
      throw new Error('ISSUER_PRIVATE_KEY_REQUIRED');
    }

    this.isInteractiveSession = manifestConfig?.isInteractiveSession ?? true;
    this.validateManifestAndEnvironment();
  }

  private validateManifestAndEnvironment(): void {
    if (this.manifestConfig?.manifestPath !== undefined) {
      const manifestPath = this.manifestConfig.manifestPath;
      if (!path.isAbsolute(manifestPath)) {
        throw new Error('ISSUER_MANIFEST_PATH_NOT_ROOTED: Manifest path must be absolute and rooted');
      }
      if (!fs.existsSync(manifestPath)) {
        throw new Error('ISSUER_MANIFEST_NOT_FOUND: Manifest file does not exist');
      }
    }

    if (this.manifestConfig?.ownerSid !== undefined) {
      const ownerSid = this.manifestConfig.ownerSid;
      // Must be SYSTEM (S-1-5-18) or Administrators (S-1-5-32-544)
      if (ownerSid !== 'S-1-5-18' && ownerSid !== 'S-1-5-32-544') {
        throw new Error('ISSUER_MANIFEST_UNTRUSTED_OWNER: Manifest must be owned by SYSTEM or Administrators');
      }
    }

    if (this.manifestConfig?.permissions !== undefined) {
      const permissions = this.manifestConfig.permissions.toLowerCase();
      if (permissions.includes('write_everyone') || permissions.includes('modify_users')) {
        throw new Error('ISSUER_MANIFEST_INSECURE_PERMISSIONS: Manifest allows non-admin write permissions');
      }
    }

    if (!this.isInteractiveSession || process.env.AGENTICOS_HEADLESS === 'true') {
      throw new Error('ISSUER_NON_INTERACTIVE_SESSION: Out-of-process issuer cannot run in non-interactive or headless session');
    }
  }

  /**
   * Validate that parameter and scope objects match the digest hashes in the binding.
   */
  public validateHashes(scope: unknown, args: unknown, binding: ApprovalBinding): void {
    const computedScopeHash = approvalHash(scope);
    const computedArgHash = approvalHash(args);
    if (computedScopeHash !== binding.scopeHash || computedArgHash !== binding.argumentHash) {
      throw new Error('ISSUER_HASH_MISMATCH: Scope or argument digest does not match binding hashes');
    }
  }

  /**
   * Produce signed approval envelope after verified human presence check.
   */
  public async issueApproval(
    binding: ApprovalBinding,
    challenge: { nonce: string; expiresAt: number },
    options: {
      now?: number;
      secondConfirmation?: boolean;
      scope?: unknown;
      args?: unknown;
      preview?: string;
    } = {},
  ): Promise<SignedApprovalEnvelope> {
    const now = options.now ?? Date.now();
    const secondConfirmation = options.secondConfirmation ?? true;

    // 1. Validate hash integrity if scope and args are provided
    if (options.scope !== undefined && options.args !== undefined) {
      this.validateHashes(options.scope, options.args, binding);
    }

    // 2. Enforce 60-second maximum lifetime
    if (challenge.expiresAt <= now || challenge.expiresAt - now > 60000) {
      throw new Error('ISSUER_LIFETIME_EXCEEDED: Approval lifetime must be <= 60 seconds');
    }

    // 3. Enforce second confirmation requirement
    if (secondConfirmation !== true) {
      throw new Error('ISSUER_SECOND_CONFIRMATION_REQUIRED: High-impact actions require explicit second confirmation');
    }

    // 4. Perform human presence challenge
    const presenceChallenge: HumanPresenceChallenge = {
      operation: binding.operation,
      tool: binding.tool,
      preview: options.preview || 'Approval for privileged operation',
      nonce: challenge.nonce,
      runtimeIncarnation: binding.runtimeIncarnation || '',
      requestedAt: now,
    };

    const present = await this.presenceProvider.verifyPresence(presenceChallenge);
    if (!present) {
      throw new Error('HUMAN_PRESENCE_REJECTED: Operator declined or failed human presence prompt');
    }

    // 5. Construct canonical payload
    const payload: ApprovalPayload = {
      ...binding,
      version: 1,
      issuer: 'agenticos-interactive-issuer',
      nonce: challenge.nonce,
      issuedAt: now,
      expiresAt: challenge.expiresAt,
      secondConfirmation: true,
    };

    const canonicalPayload = canonical(payload);

    // 6. Sign using ECDSA P-256 (ES256) with IEEE P1363 encoding
    const isEc = this.privateKey.asymmetricKeyType === 'ec';
    const sigBuffer = sign(
      isEc ? 'sha256' : null,
      Buffer.from(canonicalPayload),
      isEc ? { key: this.privateKey, dsaEncoding: 'ieee-p1363' } : this.privateKey,
    );

    return {
      algorithm: isEc ? 'ES256' : 'EdDSA',
      payload,
      canonicalPayload,
      signature: sigBuffer.toString('base64'),
    };
  }
}
