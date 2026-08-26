export const claudeLane = {
    kind: "claude",
    displayName: "Claude Code",
    configSchema: {
        type: "object",
        required: ["model"],
        properties: {
            model: { type: "string", default: "claude-sonnet-4-20250514" },
            maxTurns: { type: "number", default: 8 },
            workdir: { type: "string", default: "." },
        },
    },
    buildInput: (card) => ({
        prompt: `${card.title}\n\n${card.body}`,
        source: "kanban",
    }),
    summarizeOutput: (out) => typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
