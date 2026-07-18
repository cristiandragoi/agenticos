export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId: string;

  actionType: string;
  title: string;
  description: string;

  riskLevel: "medium" | "high" | "critical";

  preview?: unknown;
  expiresAt?: string;

  status: "pending" | "approved" | "rejected" | "expired";

  createdAt: string;
  resolvedAt?: string;
}
