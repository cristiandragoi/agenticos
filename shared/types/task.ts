export interface AgentTask {
  id: string;
  title: string;
  description?: string;

  status:
    | "draft"
    | "scheduled"
    | "queued"
    | "running"
    | "waiting_for_approval"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

  priority: "low" | "medium" | "high" | "critical";

  skillIds: string[];
  scheduleId?: string;

  input?: Record<string, unknown>;
  assignedAgentId?: string;

  requiresApproval: boolean;
  approvalPolicyId?: string;

  retryPolicy?: {
    maxAttempts: number;
    backoffSeconds: number;
  };

  timeoutSeconds?: number;

  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}
