export type LaneKind = "claude" | "codex" | "hermes" | "http";

export interface LaneConfigField {
  type: "string" | "number" | "boolean";
  default?: unknown;
  description?: string;
}

export interface LaneSchema<K extends LaneKind = LaneKind> {
  kind: K;
  displayName: string;
  configSchema: {
    type: "object";
    required: string[];
    properties: Record<string, LaneConfigField>;
  };
  buildInput(card: { title: string; body: string }): unknown;
  summarizeOutput(output: unknown): string;
}
