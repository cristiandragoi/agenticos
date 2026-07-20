// schemaRecovery.test.ts
import {
  LLMSchemaValidationError,
  normalizeTeamSheetCandidate,
  processTeamSheetCandidate
} from '../domains/teams/schemaRecovery.js';
import * as schemaRecovery from '../domains/teams/schemaRecovery.js';

describe('schemaRecovery', () => {
  describe('extractJsonFromMarkdown', () => {
    it('Extracts raw JSON', () => {
      expect(schemaRecovery.extractJsonFromMarkdown('{"a": 1}')).toBe('{"a": 1}');
    });

    it('Extracts markdown fenced JSON', () => {
      expect(schemaRecovery.extractJsonFromMarkdown('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
      expect(schemaRecovery.extractJsonFromMarkdown('```\n{"a": 1}\n```')).toBe('{"a": 1}');
    });

    it('Extracts with leading/trailing text', () => {
      expect(schemaRecovery.extractJsonFromMarkdown('Here is the json:\n```json\n{"a": 1}\n```\nEnjoy!')).toBe('{"a": 1}');
    });

    it('Rejects multiple JSON objects', () => {
      expect(() => schemaRecovery.extractJsonFromMarkdown('{"a": 1}\n{"b": 2}')).toThrow('Multiple JSON objects found');
    });

    it('Rejects truncated JSON', () => {
      expect(() => schemaRecovery.extractJsonFromMarkdown('{"a": 1')).toThrow('Truncated or malformed JSON');
    });

    it('Rejects empty response', () => {
      expect(() => schemaRecovery.extractJsonFromMarkdown('')).toThrow('No JSON object found');
    });
  });

  describe('normalizeTeamSheetCandidate', () => {
    it('Valid string[] passes unchanged', () => {
      const input = { acceptanceCriteria: ['a', 'b'] };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual(['a', 'b']);
    });

    it('{ text: string }[] becomes string[]', () => {
      const input = { acceptanceCriteria: [{ text: 'a' }, { text: 'b' }] };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual(['a', 'b']);
    });

    it('{ criterion: string }[] becomes string[]', () => {
      const input = { acceptanceCriteria: [{ criterion: 'a' }, { criterion: 'b' }] };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual(['a', 'b']);
    });

    it('A single string becomes string[]', () => {
      const input = { acceptanceCriteria: 'single criterion' };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual(['single criterion']);
    });

    it('Unsupported objects remain invalid', () => {
      const input = { acceptanceCriteria: [{ weird: 'object' }] };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual([]);
    });

    it('Empty normalized entries are rejected', () => {
      const input = { acceptanceCriteria: ['  ', { text: ' ' }, 'valid'] };
      const res = normalizeTeamSheetCandidate(input) as any;
      expect(res.acceptanceCriteria).toEqual(['valid']);
    });
  });

  describe('processTeamSheetCandidate', () => {
    it('Existing valid TeamSheet generation still works', () => {
      const validJson = JSON.stringify({
        version: "1.0",
        teamName: "Test Team",
        objective: "Test objective",
        workspaceRoot: "/",
        agents: [
          {
            id: "agent-1",
            name: "Planner",
            role: "Planner",
            responsibilities: ["planning"],
            instructions: "plan stuff",
            dependencies: [],
            allowedTools: ["read_file"],
            readScopes: [],
            writeScopes: [],
            outputArtifacts: []
          },
          {
            id: "agent-2",
            name: "Builder",
            role: "Builder",
            responsibilities: ["building"],
            instructions: "build stuff",
            dependencies: [],
            allowedTools: ["write_file"],
            readScopes: [],
            writeScopes: ["src/**"],
            outputArtifacts: []
          },
          {
            id: "agent-3",
            name: "Verifier",
            role: "Verifier",
            responsibilities: ["verifying"],
            instructions: "verify stuff",
            dependencies: ["agent-1", "agent-2"],
            allowedTools: ["read_file"],
            readScopes: [],
            writeScopes: [],
            outputArtifacts: []
          }
        ],
        handoffs: [],
        executionSequence: ["agent-1", "agent-2", "agent-3"],
        acceptanceCriteria: ["criterion 1"],
        estimatedParallelism: 1,
        approvalRequired: true
      });

      const res = processTeamSheetCandidate(validJson);
      expect(res.teamName).toBe("Test Team");
    });

    it('Throws LLMSchemaValidationError with structured details on failure', () => {
      const invalidJson = JSON.stringify({
        version: "1.0",
        teamName: "Test Team"
        // missing required fields
      });

      try {
        processTeamSheetCandidate(invalidJson);
        expect(false).toBe(true); // Should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(LLMSchemaValidationError);
        const e = err as LLMSchemaValidationError;
        expect(e.attempts).toBe(1);
        expect(e.issues.length).toBeGreaterThan(0);
        expect(e.issues[0].path).toBeDefined();
      }
    });
  });
});
