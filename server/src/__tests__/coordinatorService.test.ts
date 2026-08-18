// coordinatorService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coordinatorService } from '../domains/teams/coordinatorService.js';
import * as llmGateway from '../services/llmGateway.js';
import * as eventBusModule from '../core/eventBus.js';

// Mock dependencies
vi.mock('../services/llmGateway.js');
vi.mock('../core/eventBus.js');

describe('CoordinatorService repair logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Performs exactly one repair attempt if validation fails', async () => {
    const invalidJson = `{ "teamName": "Test Team" }`; // missing version, etc
    const validJson = `{
      "version": "1.0",
      "teamName": "Test Team",
      "objective": "Test objective",
      "workspaceRoot": "/",
      "agents": [
        {
          "id": "agent-1",
          "name": "Planner",
          "role": "Planner",
          "responsibilities": ["planning"],
          "instructions": "plan",
          "dependencies": [],
          "allowedTools": ["read_file"],
          "readScopes": [],
          "writeScopes": [],
          "outputArtifacts": []
        },
        {
          "id": "agent-2",
          "name": "Builder",
          "role": "Builder",
          "responsibilities": ["building"],
          "instructions": "build",
          "dependencies": [],
          "allowedTools": ["write_file"],
          "readScopes": [],
          "writeScopes": ["src/**"],
          "outputArtifacts": []
        },
        {
          "id": "agent-3",
          "name": "Verifier",
          "role": "Verifier",
          "responsibilities": ["verifying"],
          "instructions": "verify",
          "dependencies": ["agent-1", "agent-2"],
          "allowedTools": ["read_file"],
          "readScopes": [],
          "writeScopes": [],
          "outputArtifacts": []
        }
      ],
      "handoffs": [],
      "executionSequence": ["agent-1", "agent-2", "agent-3"],
      "acceptanceCriteria": ["criterion 1"],
      "estimatedParallelism": 1,
      "approvalRequired": true
    }`;

    // First call returns invalid, second returns valid
    (llmGateway.llmChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ reply: invalidJson })
      .mockResolvedValueOnce({ reply: validJson });

    const result = await coordinatorService.generateTeamSheet('Do the thing', '/');
    
    expect(result.teamName).toBe('Test Team');
    expect(llmGateway.llmChat).toHaveBeenCalledTimes(2);
  });

  it('Throws LLMSchemaValidationError if repair fails again', async () => {
    const invalidJson = `{ "teamName": "Test Team" }`;

    (llmGateway.llmChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ reply: invalidJson })
      .mockResolvedValueOnce({ reply: invalidJson }); // still invalid

    await expect(coordinatorService.generateTeamSheet('Do the thing', '/'))
      .rejects.toThrow('The model could not produce a valid TeamSheet');
      
    expect(llmGateway.llmChat).toHaveBeenCalledTimes(2);
  });
});
