import type { LaneSchema } from "./types.js";

export const httpLane: LaneSchema<"http"> = {
  kind: "http",
  displayName: "Generic HTTP",
  configSchema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "POST target" },
      headers: { type: "string", default: "{}" },
    },
  },
  buildInput: (card) => ({ title: card.title, body: card.body }),
  summarizeOutput: (out: unknown) =>
    typeof out === "string" ? out.slice(0, 280) : JSON.stringify(out).slice(0, 280),
};
