export interface AgentSchedule {
  id: string;
  taskId: string;

  type: "once" | "interval" | "cron";
  timezone: string;

  runAt?: string;
  intervalSeconds?: number;
  cronExpression?: string;

  enabled: boolean;
  nextRunAt?: string;
  lastTriggeredAt?: string;

  misfirePolicy: "skip" | "run_once" | "catch_up";
}
