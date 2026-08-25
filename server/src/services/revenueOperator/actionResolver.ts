/**
 * actionResolver.ts — Phase 2D canonical Revenue Operator action resolver.
 *
 * Pure mapping from an experiment's current state to ONE explicit next action.
 * Inspects engine, status, open gates, and prior completed actions (compliance
 * record presence) to decide what the supervisor should do next. Does NOT
 * execute anything — it only decides.
 */

export type RevenueActionType =
  | 'DIGITAL_DISCOVER'
  | 'DIGITAL_VALIDATE'
  | 'DIGITAL_DECIDE'
  | 'DIGITAL_BUILD'
  | 'DIGITAL_WAIT_FOR_PUBLISH_GATE'
  | 'SME_DISCOVER'
  | 'SME_QUALIFY'
  | 'SME_FIND_CONTACT'
  | 'SME_CREATE_OFFER'
  | 'SME_WAIT_FOR_OUTBOUND_GATE'
  | 'BLOCKED_INTEGRATION_REQUIRED'
  | 'NO_WORK';

export interface ResolverExperiment {
  id: string;
  engine: string;
  status: string;
  /** An OPEN human gate currently isolates this branch. */
  hasOpenGate: boolean;
  openGateType?: string | null;
  /** A gate for this branch was RESOLVED (human approved) — publish/send is next. */
  hasResolvedGate: boolean;
  /** A compliance record exists (SME findContact already ran). */
  hasComplianceRecord: boolean;
}

export interface ResolvedAction {
  actionType: RevenueActionType;
  engine: string;
  experimentId: string;
  preferredExecutorId: string | null;
  requiredCapabilities: string[];
  reason: string;
  blockedReason?: string;
}

// ── Capability hints per action (worker-level, see executorSelection.ts) ─────

const RESEARCH_CAPS = ['filesystem_read', 'external_web'];
const BUILD_CAPS = ['filesystem_write', 'process_exec', 'node', 'build', 'test', 'terminal', 'git', 'repository_workspace'];

function resolved(
  actionType: RevenueActionType,
  engine: string,
  experimentId: string,
  preferredExecutorId: string | null,
  requiredCapabilities: string[],
  reason: string,
  blockedReason?: string,
): ResolvedAction {
  return { actionType, engine, experimentId, preferredExecutorId, requiredCapabilities, reason, blockedReason };
}

/**
 * Resolve the next action for a single experiment branch.
 */
export function resolveAction(exp: ResolverExperiment): ResolvedAction {
  const id = exp.id;
  const engine = exp.engine;
  const status = exp.status;

  // ── Digital Products ─────────────────────────────────────────────────────
  if (engine === 'digital_products') {
    // Open Shopify gate isolates the branch.
    if (exp.hasOpenGate) {
      return resolved(
        'DIGITAL_WAIT_FOR_PUBLISH_GATE', engine, id, null, [],
        `Open ${exp.openGateType || 'SHOPIFY_AUTH_REQUIRED'} gate holds this branch.`,
      );
    }
    switch (status) {
      case 'DISCOVERED':
        return resolved('DIGITAL_VALIDATE', engine, id, null, [], 'Score the discovered opportunity.');
      case 'VALIDATING':
        return resolved('DIGITAL_DECIDE', engine, id, null, [], 'GO/NO-GO decision from the stored score.');
      case 'APPROVED':
        return resolved('DIGITAL_BUILD', engine, id, 'rt-codex', BUILD_CAPS, 'Build the product artifact via CodeX.');
      case 'BUILDING':
        // Build dispatched; buildProduct transitions to QA on completion.
        return resolved('NO_WORK', engine, id, null, [], 'Build already in flight; awaiting completion.');
      case 'QA':
        return resolved(
          'DIGITAL_WAIT_FOR_PUBLISH_GATE', engine, id, null, [],
          'Prepare publication: transition to READY_TO_PUBLISH and create the Shopify Human Gate.',
        );
      case 'READY_TO_PUBLISH':
        // A resolved gate means a human approved publication — but Shopify
        // publication is not implemented, so the branch blocks truthfully.
        if (exp.hasResolvedGate) {
          return resolved(
            'BLOCKED_INTEGRATION_REQUIRED', engine, id, null, [],
            'Human gate resolved; Shopify publication is not implemented.',
            'SHOPIFY_PUBLISH_NOT_IMPLEMENTED',
          );
        }
        return resolved(
          'DIGITAL_WAIT_FOR_PUBLISH_GATE', engine, id, null, [],
          'Ready to publish; create/preserve the Shopify Human Gate (publication not implemented).',
        );
      case 'PUBLISHING':
        return resolved(
          'BLOCKED_INTEGRATION_REQUIRED', engine, id, null, [],
          'Shopify publication is not implemented; no publish can execute.',
          'SHOPIFY_PUBLISH_NOT_IMPLEMENTED',
        );
      case 'KILLED':
        return resolved('NO_WORK', engine, id, null, [], 'Experiment killed — terminal.');
      default:
        return resolved('NO_WORK', engine, id, null, [], `Status ${status} has no autonomous next action.`);
    }
  }

  // ── German SME ────────────────────────────────────────────────────────────
  if (engine === 'german_sme') {
    if (exp.hasOpenGate) {
      return resolved(
        'SME_WAIT_FOR_OUTBOUND_GATE', engine, id, null, [],
        `Open ${exp.openGateType || 'OUTBOUND_APPROVAL'} gate holds this branch.`,
      );
    }
    switch (status) {
      case 'DISCOVERED':
        // inspect business profile via Hermes research.
        return resolved('SME_QUALIFY', engine, id, 'rt-hermes', RESEARCH_CAPS, 'Inspect the company public profile.');
      case 'VALIDATING':
        // score + GO/NO-GO (DB logic).
        return resolved('SME_QUALIFY', engine, id, null, [], 'Qualify (score + GO/NO-GO).');
      case 'APPROVED':
        if (!exp.hasComplianceRecord) {
          return resolved('SME_FIND_CONTACT', engine, id, 'rt-hermes', RESEARCH_CAPS, 'Find a public business contact.');
        }
        return resolved('SME_CREATE_OFFER', engine, id, 'rt-hermes', RESEARCH_CAPS, 'Draft a tailored offer.');
      case 'BUILDING':
        return resolved(
          'SME_WAIT_FOR_OUTBOUND_GATE', engine, id, null, [],
          'Offer drafted; require OUTBOUND_APPROVAL Human Gate before any send.',
        );
      case 'QA':
      case 'READY_TO_PUBLISH':
        // A resolved gate means a human approved outreach — but sending is not
        // implemented, so the branch blocks truthfully.
        if (exp.hasResolvedGate) {
          return resolved(
            'BLOCKED_INTEGRATION_REQUIRED', engine, id, null, [],
            'Human gate resolved; outreach sending is not implemented.',
            'OUTREACH_SEND_NOT_IMPLEMENTED',
          );
        }
        return resolved(
          'SME_WAIT_FOR_OUTBOUND_GATE', engine, id, null, [],
          'Outreach requires OUTBOUND_APPROVAL Human Gate; sending is not implemented.',
        );
      case 'PUBLISHING':
        return resolved(
          'BLOCKED_INTEGRATION_REQUIRED', engine, id, null, [],
          'Outreach sending is not implemented; no send can execute.',
          'OUTREACH_SEND_NOT_IMPLEMENTED',
        );
      case 'LIVE':
      case 'WON':
      case 'LOST':
        return resolved('NO_WORK', engine, id, null, [], `Status ${status} is terminal for the outreach pipeline.`);
      case 'KILLED':
        return resolved('NO_WORK', engine, id, null, [], 'Experiment killed — terminal.');
      default:
        return resolved('NO_WORK', engine, id, null, [], `Status ${status} has no autonomous next action.`);
    }
  }

  return resolved('NO_WORK', engine, id, null, [], `Unknown engine ${engine}.`);
}
