export interface AgentRun {
  id: string;
  taskId: string;
  trigger: "manual" | "schedule" | "api" | "agent" | "retry";

  status:
    | "queued"
    | "running"
    | "waiting_for_approval"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out";

  attempt: number;

  input?: Record<string, unknown>;
  output?: Record<string, unknown>;

  error?: {
    code?: string;
    message: string;
    stack?: string;
  };

  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface RunStep {
  id: string;
  runId: string;
  skillId?: string;
  toolId?: string;

  status: "pending" | "running" | "completed" | "failed";

  input?: unknown;
  output?: unknown;
  error?: string;

  startedAt?: string;
  completedAt?: string;
}
