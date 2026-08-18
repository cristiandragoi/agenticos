import { claudeLane } from "./claude.js";
import { codexLane } from "./codex.js";
import { hermesLane } from "./hermes.js";
import { httpLane } from "./http.js";
import type { LaneSchema, LaneKind } from "./types.js";

export const lanes: Record<LaneKind, LaneSchema> = {
  claude: claudeLane as LaneSchema,
  codex: codexLane as LaneSchema,
  hermes: hermesLane as LaneSchema,
  http: httpLane as LaneSchema,
};

export function getLane(kind: LaneKind): LaneSchema {
  const lane = lanes[kind];
  if (!lane) throw new Error(`Unknown lane kind: ${kind}`);
  return lane;
}

export type { LaneSchema, LaneKind } from "./types.js";
export * from "./types.js";
