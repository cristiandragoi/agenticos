import type { DataPort, Id } from "../dataport/index.js";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunRecord {
  id: Id;
  cardId: Id;
  laneId: Id;
  status: RunStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  workerKind: string;
}
