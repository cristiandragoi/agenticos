/**
 * Tool Registry — central registry of all tools available to agents.
 *
 * Each tool has:
 *  - name + description (for LLM function-calling schema)
 *  - parameters (JSON Schema for the LLM)
 *  - handler (async function that takes args, returns string)
 *
 * Tools are registered at import time and discovered by the agent loop.
 */

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** The actual handler. Receives parsed args object. Returns result string. */
  handler: (args: Record<string, unknown>) => Promise<string>;
  /** Optional: only include this tool when the condition is met */
  enabled?: () => boolean;
}

export type ToolSchema = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Get all tools that are currently enabled */
  getAllEnabled(): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.enabled || tool.enabled()) {
        result.push(tool);
      }
    }
    return result;
  }

  /** Convert enabled tools to OpenAI-compatible function-calling schema */
  getToolSchemas(): ToolSchema[] {
    return this.getAllEnabled().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            tool.parameters.map(p => [
              p.name,
              {
                type: p.type,
                description: p.description,
                ...(p.enum ? { enum: p.enum } : {}),
              },
            ])
          ),
          required: tool.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  /** Execute a tool call by name. Returns the result string or throws. */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(args);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const toolRegistry = new ToolRegistry();
