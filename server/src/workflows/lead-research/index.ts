/**
 * Lead Research Agent Team Registry
 * Central export of all 10 specialized agents for easy import by orchestrator or CLI
 */

import { leadScoutAgent } from './agents/leadScout.js';
import { companyIntelligenceAgent } from './agents/companyIntelligence.js';
import { buyingSignalAgent } from './agents/buyingSignal.js';
import { decisionMakerAgent } from './agents/decisionMaker.js';
import { technicalFitAgent } from './agents/technicalFit.js';
import { leadQualificationAgent } from './agents/leadQualification.js';
import { contactVerificationAgent } from './agents/contactVerification.js';
import { coldCallPreparationAgent } from './agents/coldCallPreparation.js';
import { qaDeduplicationAgent } from './agents/qaDeduplication.js';
import { leadOrchestrator } from './orchestrator.js';

export const leadResearchAgents = {
  orchestrator: leadOrchestrator,
  leadScout: leadScoutAgent,
  companyIntelligence: companyIntelligenceAgent,
  buyingSignal: buyingSignalAgent,
  decisionMaker: decisionMakerAgent,
  technicalFit: technicalFitAgent,
  leadQualification: leadQualificationAgent,
  contactVerification: contactVerificationAgent,
  coldCallPreparation: coldCallPreparationAgent,
  qaDeduplication: qaDeduplicationAgent,
};

export type LeadResearchAgent = typeof leadResearchAgents[keyof typeof leadResearchAgents];

export const AGENT_COUNT = 10;

// Pipeline stages for state tracking
export const PIPELINE_STAGES = [
  'DISCOVERED',
  'RESEARCHING',
  'SIGNAL_CONFIRMED',
  'CONTACT_RESEARCH',
  'QUALIFICATION',
  'VERIFICATION',
  'CALL_READY',
  'CALLED',
  'FOLLOW_UP',
  'WON',
  'LOST',
  'ARCHIVED',
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];
