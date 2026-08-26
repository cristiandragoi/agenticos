export const codexLane = {
    kind: "codex",
    displayName: "Codex CLI",
    configSchema: {
        type: "object",
        required: ["model"],
        properties: {
            model: { type: "string", default: "gpt-5" },
            approval: { type: "string", default: "never" },
            workdir: { type: "string", default: "." },
        },
    },
    buildInput: (card) => ({
        prompt: `${card.title}\n\n${card.body}`,
        source: "kanban",
    }),
    summarizeOutput: (out) => typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
