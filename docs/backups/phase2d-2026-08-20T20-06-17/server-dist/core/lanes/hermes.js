export const hermesLane = {
    kind: "hermes",
    displayName: "Hermes Agent",
    configSchema: {
        type: "object",
        required: ["model"],
        properties: {
            model: { type: "string", default: "anthropic/claude-sonnet-4" },
            systemPrompt: {
                type: "string",
                default: "You are a helpful assistant.",
            },
        },
    },
    buildInput: (card) => ({
        prompt: `${card.title}\n\n${card.body}`,
        source: "kanban",
    }),
    summarizeOutput: (out) => typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
