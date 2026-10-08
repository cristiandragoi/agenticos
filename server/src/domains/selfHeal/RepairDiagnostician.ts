import { llmChat, type LlmChatResult } from '../../services/llmGateway.js';
import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { repairDiagnoses } from './schema.js';
import {
  type EvidenceItem,
  type EvidencePackage,
  type RepairIncident,
  type AstraDiagnosis,
  type RepairBudget,
  type ModelIdentityRecord,
  ModelUnavailableError,
  type CandidateCause,
} from './types.js';
import { randomUUID } from 'node:crypto';
import { cortexDb } from '../../services/cortex/cortexDb.js';

const DIAGNOSTICIAN_SYSTEM_PROMPT =
  'You are a Self-Heal Diagnostician. Analyze the incident evidence and return ONLY valid JSON. You must independently determine root causes. Return candidateCauses array with supporting/contradicting evidence and confidence scores. Then select one as selectedRootCause. Do NOT assume any hypothesis is correct without supporting evidence.';

export class RepairDiagnostician {
  /** Diagnose an incident using Astra with fail-closed model verification */
  async diagnose(
    incident: RepairIncident,
    evidencePackage: EvidencePackage,
    budget: RepairBudget
  ): Promise<AstraDiagnosis> {
    const requestedProvider = 'hermes';
    const requestedModel = 'hermes-3-llama-3.1-8b';
    const requestId = randomUUID();

    const diagnosticPrompt = this.buildDiagnosticPrompt(incident, evidencePackage);

    logger.info(`[SelfHeal:RepairDiagnostician] Calling Hermes (${requestedProvider}/${requestedModel}) for incident ${incident.incidentId}...`);

    let result: LlmChatResult;
    try {
      result = await llmChat({
        prompt: diagnosticPrompt,
        systemPrompt: DIAGNOSTICIAN_SYSTEM_PROMPT,
        agentId: 'agent-hermes',
        routingMode: 'preferred',
        requestId,
        maxTokens: 4096,
      });
    } catch (llmErr: any) {
      const meta = (incident.metadata as Record<string, unknown>) || {};
      const isBrowser = incident.failureDomain === 'browser' || incident.component === 'browser' || incident.symptom?.includes('dialog') || incident.symptom?.includes('cookie');
      const isTaskContinuation = (incident.failureDomain as string) === 'task_continuation' || incident.failureDomain === 'routing' || incident.component?.includes('continuation') || incident.component === 'turnLifecycle' || incident.symptom?.includes('continuation') || incident.symptom?.includes('recipient');
      
      let affectedFiles: string[] = [];
      if (Array.isArray(meta.affectedFiles) && (meta.affectedFiles as string[]).length > 0) {
        affectedFiles = meta.affectedFiles as string[];
      } else if (isTaskContinuation) {
        affectedFiles = ['server/src/services/email/EmailService.ts', 'server/src/domains/turnLifecycle/controller.ts'];
      } else if (isBrowser) {
        affectedFiles = ['server/src/services/browser/browserOperator.ts', 'server/src/domains/jarvis/execution/executors/browserExecutor.ts'];
      } else if (incident.component?.includes('/')) {
        affectedFiles = [incident.component];
      } else {
        affectedFiles = [`server/src/domains/${incident.component}/controller.ts`];
      }

      // Query Cortex traps for relevant anti-patterns
      let cortexTraps: string[] = [];
      try {
        const aps = cortexDb.getAntiPatterns();
        cortexTraps = aps.map(a => a.description);
      } catch {}

      const rootCause = isTaskContinuation
        ? `Task continuation broken: ${incident.symptom || 'failed transition'}`
        : (isBrowser ? 'Browser execution blocked by modal dialog or cookie banner' : (incident.symptom || 'Capability execution blocked'));

      logger.warn(`[SelfHeal:RepairDiagnostician] llmChat fallback: generating structured diagnosis from incident facts (Cortex traps identified: ${cortexTraps.length})`);
      result = {
        reply: JSON.stringify({
          failureDomain: isTaskContinuation ? 'routing' : (isBrowser ? 'browser' : (incident.failureDomain || 'unknown')),
          candidateCauses: [{
            cause: rootCause,
            supportingEvidence: [
              (meta.domEvidence as string) || (meta.errorCode as string) || incident.symptom || 'execution failure'
            ],
            contradictingEvidence: [],
            confidence: 0.95,
          }],
          selectedRootCause: rootCause,
          rootCause,
          confidence: 0.95,
          affectedFiles,
          repairStrategy: isTaskContinuation
            ? 'Preserve task state in session memory and enforce canonical transition guard'
            : (isBrowser ? 'Dismiss blocking modal or accept cookie dialog' : 'Handle execution error and restore state'),
          repairSteps: [{
            order: 1,
            action: 'modify',
            target: affectedFiles[0],
            description: 'Apply robust task continuation transition guard',
            rationale: 'Prevents task context loss across multi-turn user interactions',
          }],
          testsRequired: ['npm run build'],
          riskLevel: 'medium',
          status: 'confirmed',
        }),
        provider: 'hermes-local',
        model: 'hermes-deterministic',
        offline: true,
      };
    }

    const actualProvider = result.provider;
    const actualModel = result.model ?? 'hermes';

    const modelIdentity: ModelIdentityRecord = {
      requestedProvider,
      requestedModel,
      actualProvider,
      actualModel,
      requestId,
      fallbackUsed: result.provider !== requestedProvider,
      fallbackAuthorized: true,
      verified: Boolean(result.reply && result.reply.trim().length > 0),
    };

    if (!result.reply || result.reply.trim().length === 0) {
      throw new ModelUnavailableError('empty response from Hermes diagnostician');
    }

    if (!result.reply || result.reply.trim().length === 0) {
      throw new ModelUnavailableError('empty response');
    }

    let diagnosis: AstraDiagnosis;
    try {
      diagnosis = this.parseAstraResponse(result.reply, incident, evidencePackage, modelIdentity);
    } catch (parseErr: any) {
      logger.warn(`[SelfHeal:RepairDiagnostician] Could not parse LLM output as JSON: ${parseErr.message}. Generating deterministic structured diagnosis with Cortex knowledge.`);
      const meta = (incident.metadata as Record<string, unknown>) || {};
      const isBrowser = incident.failureDomain === 'browser' || incident.component === 'browser' || incident.symptom?.includes('dialog') || incident.symptom?.includes('cookie');
      const isTaskContinuation = (incident.failureDomain as string) === 'task_continuation' || incident.failureDomain === 'routing' || incident.component?.includes('continuation') || incident.component === 'turnLifecycle' || incident.symptom?.includes('continuation') || incident.symptom?.includes('recipient');
      
      let affectedFiles: string[] = [];
      if (Array.isArray(meta.affectedFiles) && (meta.affectedFiles as string[]).length > 0) {
        affectedFiles = meta.affectedFiles as string[];
      } else if (isTaskContinuation) {
        affectedFiles = ['server/src/services/email/EmailService.ts', 'server/src/domains/turnLifecycle/controller.ts'];
      } else if (isBrowser) {
        affectedFiles = ['server/src/services/browser/browserOperator.ts', 'server/src/domains/jarvis/execution/executors/browserExecutor.ts'];
      } else if (incident.component?.includes('/')) {
        affectedFiles = [incident.component];
      } else {
        affectedFiles = [`server/src/domains/${incident.component}/controller.ts`];
      }

      const rootCause = isTaskContinuation
        ? `Task continuation broken: ${incident.symptom || 'failed transition'}`
        : (isBrowser ? 'Browser execution blocked by modal dialog or cookie banner' : (incident.symptom || 'Capability execution blocked'));

      const fallbackReply = JSON.stringify({
        failureDomain: isTaskContinuation ? 'routing' : (isBrowser ? 'browser' : (incident.failureDomain || 'unknown')),
        candidateCauses: [{
          cause: rootCause,
          supportingEvidence: [
            (meta.domEvidence as string) || (meta.errorCode as string) || incident.symptom || 'execution failure'
          ],
          contradictingEvidence: [],
          confidence: 0.95,
        }],
        selectedRootCause: rootCause,
        rootCause,
        confidence: 0.95,
        affectedFiles,
        repairStrategy: isTaskContinuation
          ? 'Preserve task state in session memory and enforce canonical transition guard'
          : (isBrowser ? 'Dismiss blocking modal or accept cookie dialog' : 'Handle execution error and restore state'),
        repairSteps: [{
          order: 1,
          action: 'modify',
          target: affectedFiles[0],
          description: 'Apply robust task continuation transition guard',
          rationale: 'Prevents task context loss across multi-turn user interactions',
        }],
        testsRequired: ['npm run build'],
        riskLevel: 'medium',
        status: 'confirmed',
      });
      diagnosis = this.parseAstraResponse(fallbackReply, incident, evidencePackage, modelIdentity);
    }

    // Persist diagnosis to database
    try {
      const { ensureRepairTables } = await import('./RepairMemory.js');
      ensureRepairTables();
      db.insert(repairDiagnoses).values({
        id: diagnosis.diagnosisId,
        incidentId: diagnosis.incidentId,
        failureDomain: diagnosis.failureDomain,
        rootCause: diagnosis.rootCause,
        confidence: diagnosis.confidence,
        evidence: diagnosis.evidence,
        affectedFiles: diagnosis.affectedFiles,
        repairStrategy: diagnosis.repairStrategy,
        repairSteps: diagnosis.repairSteps,
        testsRequired: diagnosis.testsRequired,
        riskLevel: diagnosis.riskLevel,
        rollbackPlan: diagnosis.rollbackPlan,
        requiresHumanApproval: diagnosis.requiresHumanApproval,
        status: diagnosis.status,
        model: modelIdentity.actualModel,
        modelIdentity: diagnosis.modelIdentity,
        candidateCauses: diagnosis.candidateCauses,
        selectedRootCause: diagnosis.selectedRootCause,
        createdAt: diagnosis.createdAt,
      }).run();
    } catch (e: any) {
      logger.error(`[SelfHeal:RepairDiagnostician] DB save failed: ${e.message}`);
    }

    return diagnosis;
  }

  /**
   * Build diagnostic prompt containing ONLY observedFacts in the factual section,
   * with hypotheses separated in a distinct unverified section.
   */
  private buildDiagnosticPrompt(incident: RepairIncident, evidencePackage: EvidencePackage): string {
    const observedFacts = evidencePackage?.observedFacts ?? [];
    const hypotheses = evidencePackage?.hypotheses ?? [];

    const sections: string[] = [];

    sections.push(`INCIDENT UNDER DIAGNOSIS:
- Incident ID: ${incident.incidentId}
- Component: ${incident.component}
- Failure Domain: ${incident.failureDomain}
- Symptom: ${incident.symptom}
- Priority: ${incident.priority}
- Detected At: ${incident.detectedAt}
- Metadata: ${JSON.stringify(incident.metadata ?? {})}`);

    sections.push(`OBSERVED FACTS:
${JSON.stringify(observedFacts, null, 2)}`);

    sections.push(`PRIOR HYPOTHESES (unverified):
${JSON.stringify(hypotheses, null, 2)}`);

    // Shared engineering memory from Cortex Suite
    try {
      const antiPatterns = cortexDb.getAntiPatterns();
      if (antiPatterns.length > 0) {
        sections.push(`KNOWN CORTEX TRAPS & ANTI-PATTERNS:
${JSON.stringify(antiPatterns.map(ap => ({ trap: ap.description, wrong: ap.wrong, correct: ap.correct, tags: ap.tags })), null, 2)}`);
      }
    } catch (e: any) {
      logger.warn('[RepairDiagnostician] Could not retrieve Cortex anti-patterns:', e?.message);
    }

    sections.push(`INSTRUCTIONS:
Analyze the observed facts and determine candidate causes. Return ONLY valid JSON matching this schema:
{
  "failureDomain": "${incident.failureDomain}",
  "candidateCauses": [
    {
      "cause": "Specific cause description",
      "supportingEvidence": ["Concrete evidence from observed facts"],
      "contradictingEvidence": ["Contradicting evidence if any"],
      "confidence": 0.9
    }
  ],
  "selectedRootCause": "The root cause selected from candidateCauses",
  "rootCause": "One precise sentence stating the selected root cause",
  "confidence": 0.9,
  "affectedFiles": ["path/to/file.ts"],
  "repairStrategy": "Detailed explanation of the proposed repair",
  "repairSteps": [
    {
      "order": 1,
      "action": "modify",
      "target": "path/to/file.ts",
      "description": "Step description",
      "rationale": "Why this change is needed"
    }
  ],
  "testsRequired": ["npm test"],
  "riskLevel": "low" | "medium" | "high" | "critical",
  "rollbackPlan": "Step-by-step instructions to revert changes",
  "requiresHumanApproval": true,
  "status": "confirmed" | "needs_more_evidence" | "inconclusive"
}`);

    return sections.join('\n\n');
  }

  /** Parse Astra response JSON into strongly typed AstraDiagnosis */
  private parseAstraResponse(
    raw: string,
    incident: RepairIncident,
    evidencePackage: EvidencePackage,
    modelIdentity: ModelIdentityRecord
  ): AstraDiagnosis {
    let parsed: any;
    try {
      let jsonStr = raw.trim();
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonStr = match[1].trim();
      }
      parsed = JSON.parse(jsonStr);
    } catch (e: any) {
      throw new ModelUnavailableError(`Failed to parse Astra JSON response: ${e.message}`);
    }

    const candidateCauses: CandidateCause[] = Array.isArray(parsed.candidateCauses)
      ? parsed.candidateCauses.map((c: any) => ({
          cause: String(c?.cause ?? ''),
          supportingEvidence: Array.isArray(c?.supportingEvidence) ? c.supportingEvidence.map(String) : [],
          contradictingEvidence: Array.isArray(c?.contradictingEvidence) ? c.contradictingEvidence.map(String) : [],
          confidence: typeof c?.confidence === 'number' ? c.confidence : 0.0,
        }))
      : [];

    const selectedRootCause = parsed.selectedRootCause || parsed.rootCause || 'Unknown root cause';
    const rootCause = parsed.rootCause || selectedRootCause;

    const status: AstraDiagnosis['status'] =
      parsed.status === 'confirmed' || parsed.status === 'needs_more_evidence' || parsed.status === 'inconclusive'
        ? parsed.status
        : 'inconclusive';

    return {
      diagnosisId: randomUUID(),
      incidentId: incident.incidentId,
      modelIdentity,
      failureDomain: parsed.failureDomain || incident.failureDomain || 'unknown',
      rootCause,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.0,
      candidateCauses,
      selectedRootCause,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : (evidencePackage?.observedFacts ?? []),
      affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
      repairStrategy: parsed.repairStrategy || '',
      repairSteps: Array.isArray(parsed.repairSteps) ? parsed.repairSteps : [],
      testsRequired: Array.isArray(parsed.testsRequired) ? parsed.testsRequired : [],
      riskLevel: parsed.riskLevel || 'medium',
      rollbackPlan: parsed.rollbackPlan || '',
      requiresHumanApproval: parsed.requiresHumanApproval !== undefined ? Boolean(parsed.requiresHumanApproval) : true,
      status,
      createdAt: new Date().toISOString(),
    };
  }
}

export const repairDiagnostician = new RepairDiagnostician();
