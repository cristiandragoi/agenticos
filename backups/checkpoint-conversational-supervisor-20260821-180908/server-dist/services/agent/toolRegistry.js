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
class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    /** Get all tools that are currently enabled */
    getAllEnabled() {
        const result = [];
        for (const tool of this.tools.values()) {
            if (!tool.enabled || tool.enabled()) {
                result.push(tool);
            }
        }
        return result;
    }
    /** Convert enabled tools to OpenAI-compatible function-calling schema */
    getToolSchemas() {
        return this.getAllEnabled().map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: Object.fromEntries(tool.parameters.map(p => [
                        p.name,
                        {
                            type: p.type,
                            description: p.description,
                            ...(p.enum ? { enum: p.enum } : {}),
                        },
                    ])),
                    required: tool.parameters.filter(p => p.required).map(p => p.name),
                },
            },
        }));
    }
    /** Execute a tool call by name. Returns the result string or throws. */
    async execute(name, args) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }
        return tool.handler(args);
    }
    list() {
        return Array.from(this.tools.keys());
    }
}
export const toolRegistry = new ToolRegistry();
