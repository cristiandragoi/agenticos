import { z } from 'zod';

export const teamAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['Planner', 'Builder', 'Verifier']),
  responsibilities: z.array(z.string()),
  instructions: z.string(),
  dependencies: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  readScopes: z.array(z.string()).default([]),
  writeScopes: z.array(z.string()).default([]),
  outputArtifacts: z.array(z.string()).default([]),
});

export type TeamAgent = z.infer<typeof teamAgentSchema>;

export const teamHandoffSchema = z.object({
  from: z.string(),
  to: z.string(),
  artifact: z.string(),
  required: z.boolean(),
});

export type TeamHandoff = z.infer<typeof teamHandoffSchema>;

export const teamSheetBaseSchema = z.object({
  version: z.literal('1.0'),
  teamName: z.string(),
  objective: z.string(),
  workspaceRoot: z.string(),
  agents: z.array(teamAgentSchema),
  handoffs: z.array(teamHandoffSchema).default([]),
  executionSequence: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()).default([]),
  estimatedParallelism: z.number().int().min(1).max(2).default(1),
  approvalRequired: z.boolean().default(true),
  approvalPolicy: z.enum(['manual', 'auto']).optional(),
});

export const teamSheetSchema = teamSheetBaseSchema.superRefine((data, ctx) => {
  const agentIds = new Set(data.agents.map(a => a.id));

  // 1. Dependency checks
  for (const agent of data.agents) {
    if (agent.dependencies.includes(agent.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Agent ${agent.id} depends on itself` });
    }
    for (const dep of agent.dependencies) {
      if (!agentIds.has(dep)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Agent ${agent.id} depends on unknown agent ${dep}` });
      }
    }
  }

  // 2. Cycle detection (DFS)
  const visited = new Set<string>();
  const recStack = new Set<string>();
  
  const hasCycle = (agentId: string): boolean => {
    if (!visited.has(agentId)) {
      visited.add(agentId);
      recStack.add(agentId);
      const agent = data.agents.find(a => a.id === agentId);
      if (agent) {
        for (const dep of agent.dependencies) {
          if (!visited.has(dep) && hasCycle(dep)) {
            return true;
          } else if (recStack.has(dep)) {
            return true;
          }
        }
      }
    }
    recStack.delete(agentId);
    return false;
  };
  
  for (const agent of data.agents) {
    if (hasCycle(agent.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Dependency cycle detected involving agent ${agent.id}` });
      break;
    }
  }

  // 3. Execution Sequence checks
  if (data.executionSequence.length !== agentIds.size) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `executionSequence must contain every agent exactly once` });
  }
  const seqSet = new Set(data.executionSequence);
  if (seqSet.size !== data.executionSequence.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `executionSequence contains duplicates` });
  }
  for (const id of data.executionSequence) {
    if (!agentIds.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `executionSequence contains unknown agent ${id}` });
    }
  }

  // 4. Dependency order
  const executed = new Set<string>();
  for (const id of data.executionSequence) {
    const agent = data.agents.find(a => a.id === id);
    if (agent) {
      for (const dep of agent.dependencies) {
        if (!executed.has(dep)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Agent ${id} is executed before its dependency ${dep}` });
        }
      }
    }
    executed.add(id);
  }

  // 5. Role counts
  const planners = data.agents.filter(a => a.role === 'Planner');
  const builders = data.agents.filter(a => a.role === 'Builder');
  const verifiers = data.agents.filter(a => a.role === 'Verifier');

  if (planners.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Exactly one Planner must exist` });
  }
  if (builders.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At least one Builder must exist` });
  }
  if (verifiers.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Exactly one Verifier must exist` });
  }

  // 6. Verifier dependencies
  if (verifiers.length === 1) {
    const verifier = verifiers[0];
    const implAgents = [...planners, ...builders].map(a => a.id);
    for (const impl of implAgents) {
      if (!verifier.dependencies.includes(impl)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Verifier must depend on all implementation agents (missing ${impl})` });
      }
    }
  }

  // 7. Path traversal and absolute paths
  for (const agent of data.agents) {
    const allPaths = [...agent.outputArtifacts, ...agent.readScopes, ...agent.writeScopes];
    for (const p of allPaths) {
      if (p.includes('..') || p.includes('../') || p.includes('..\\')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Path traversal detected in agent ${agent.id}: ${p}` });
      }
      if (p.startsWith('/') || p.startsWith('\\') || p.match(/^[a-zA-Z]:/)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Absolute path detected in agent ${agent.id}: ${p} (must be relative)` });
      }
    }
    // Check write scope for builder
    if (agent.role === 'Builder' && agent.writeScopes.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Builder ${agent.id} must have explicit write scopes` });
    }
    // Check verifier permissions
    if (agent.role === 'Verifier' && agent.writeScopes.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Verifier ${agent.id} cannot have source-code write permissions` });
    }
  }
});

export type TeamSheet = z.infer<typeof teamSheetBaseSchema>;
