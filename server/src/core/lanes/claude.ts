import type { LaneSchema } from "./types.js";

export const claudeLane: LaneSchema<"claude"> = {
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
  summarizeOutput: (out: unknown) =>
    typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
