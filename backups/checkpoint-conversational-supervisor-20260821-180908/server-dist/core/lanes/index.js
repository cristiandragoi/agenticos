import { claudeLane } from "./claude.js";
import { codexLane } from "./codex.js";
import { hermesLane } from "./hermes.js";
import { httpLane } from "./http.js";
export const lanes = {
    claude: claudeLane,
    codex: codexLane,
    hermes: hermesLane,
    http: httpLane,
};
export function getLane(kind) {
    const lane = lanes[kind];
    if (!lane)
        throw new Error(`Unknown lane kind: ${kind}`);
    return lane;
}
export * from "./types.js";
