import type { LaneSchema } from "./types.js";

export const hermesLane: LaneSchema<"hermes"> = {
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
  summarizeOutput: (out: unknown) =>
    typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
