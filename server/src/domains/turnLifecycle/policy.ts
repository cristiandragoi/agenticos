/**
 * turnLifecycle/policy.ts — POLICY/PERMISSION stage. Runs before anything executes.
 */
import type { PolicyDecision, TurnGoal, TurnRequest } from './types.js';

const DESKTOP_SOURCES_REQUIRING_OPT_IN = new Set(['certification']);

export async function decidePolicy(req: TurnRequest, goal: TurnGoal): Promise<PolicyDecision> {
  if (goal.kind === 'answer') return { allowed: true, reason: 'answer-only request', capability: 'conversation' };
  if (goal.kind === 'control') return { allowed: true, reason: 'control request', capability: 'control' };

  const type = goal.action?.type || 'other';
  const capability = type === 'open_url' ? 'browser.navigate' : type === 'other' ? 'legacy.action' : 'desktop.control';

  // Certification must never drive the real desktop of an installed production runtime.
  if (DESKTOP_SOURCES_REQUIRING_OPT_IN.has(req.source)) {
    const optedIn = process.env.AGENTICOS_CERTIFICATION_DESKTOP === '1' && process.env.AGENTICOS_IS_PACKAGED !== 'true';
    if (!optedIn) {
      return { allowed: false, reason: 'certification may not perform desktop/browser actions in this runtime', capability };
    }
  }

  if (capability !== 'legacy.action') {
    try {
      const { capabilityPermissionStore } = await import('../controlPlane/CapabilityPermissionStore.js');
      if (!capabilityPermissionStore.isAllowed(capability)) {
        return { allowed: false, reason: `permission "${capability}" is not granted`, capability };
      }
    } catch (err: any) {
      return { allowed: false, reason: `permission store unavailable: ${err?.message || err}`, capability };
    }
  }
  return { allowed: true, reason: 'permitted', capability };
}
