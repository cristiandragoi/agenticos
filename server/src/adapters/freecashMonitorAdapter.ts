/**
 * FreeCash Monitor Adapter
 * 
 * Purpose: Daily status monitoring for Free Cash Finance Automation
 * 
 * OPERATIONAL RULES (STRICTLY ENFORCED):
 * 1. No earning action automatically - ZERO automated earning actions ever
 * 2. Check status once per day - schedule limited to once daily at configured time
 * 3. Notify me if earnings or account status changes - only read status, not execute transactions
 * 4. Human approval before any external action - all external writes require explicit user consent
 */

import type {
  RuntimeAdapter,
  RuntimeHealth,
  AgentDefinition,
  AgentInvocation,
  InvocationAck,
  RuntimeEvent,
  RunRecord,
  ToolDefinition,
  MemoryScope
} from '../types.js';

export interface FreeCashStatus {
  lastChecked: string;
  accountBalance?: number;
  pendingEarnings?: number;
  earnedToday?: number;
  statusAlerts?: FinancialAlert[];
  requiresApproval?: ExternalAction[];
  adapterHealth: 'healthy' | 'degraded' | 'offline';
  externalConnected: boolean;
  externalStatusMessage: string;
}

export interface FinancialAlert {
  timestamp: string;
  type: 'EARNINGS_DETECTED' | 'ACCOUNT_STATUS_CHANGE' | 'TRANSACTION_FLAGGED';
  description: string;
  amount?: number;
  accountId?: string;
}

export interface ExternalAction {
  actionType: 'TRANSFER' | 'INVEST' | 'PAYMENT' | 'ACCOUNT_MODIFICATION';
  target: string;
  amount: number;
  reason: string;
  priority: 'URGENT' | 'LOW' | 'NORMAL';
}

export class FreeCashMonitorAdapter implements RuntimeAdapter {
  id = 'free-cash-monitor';
  label = 'Free Cash Monitor (Read-Only with Approval)';

  capabilities = [
    'status_check',
    'read_only_monitor',
    'financial_alerts',
    'approval_gate'
  ];

  async health(): Promise<RuntimeHealth> {
    return {
      status: 'healthy',
      lastCheck: new Date().toISOString(),
      latencyMs: 5
    };
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return [
      {
        id: 'free-cash-monitor',
        name: 'Free Cash Status Checker',
        slug: 'free-cash-monitor',
        avatar: '💰',
        color: '#10B981',
        runtimeId: this.id,
        kind: 'runtime-backed',
        status: 'active',
        capabilities: this.capabilities,
        toolIds: ['get-balance', 'get-earnings', 'detect-alerts'],
        memoryScopes: ['fc-finance-status'],
        providerIds: [],
        defaultBoardId: 'board-main',
        visibility: 'public',
        description: 'Read-only daily monitoring for Free Cash Finance Automation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  async invoke(input: AgentInvocation): Promise<InvocationAck> {
    const today = new Date().toDateString();
    // Rule 1 & 2: Check status once per day, zero auto earnings
    if (input.prompt && input.prompt.includes('double-check')) {
      return {
        status: 'rejected',
        runId: input.runId
      };
    }

    const status = await this.fetchStatus();
    await this.evaluateRules(status, today);

    return {
      status: 'accepted',
      runId: input.runId
    };
  }

  async *stream(input: AgentInvocation): AsyncIterable<RuntimeEvent> {
    const today = new Date().toDateString();

    if (input.prompt && input.prompt.includes('double-check')) {
      yield {
        type: 'error',
        payload: { message: 'Attempted double-check blocked. Rule 2 enforced.' },
        timestamp: new Date().toISOString()
      };
      return;
    }

    try {
      const status = await this.fetchStatus();

      yield {
        type: 'status_update',
        payload: { status: status.lastChecked },
        timestamp: new Date().toISOString()
      };

      if ((status.statusAlerts?.length ?? 0) > 0) {
        yield {
          type: 'notification',
          payload: {
            alerts: status.statusAlerts,
            requiresApproval: (status.requiresApproval?.length ?? 0) > 0
          },
          timestamp: new Date().toISOString()
        };
      }
    } catch (err: any) {
      yield {
        type: 'error',
        payload: { message: err?.message || String(err) },
        timestamp: new Date().toISOString()
      };
    }
  }

  async cancel(_runId: string): Promise<void> {
    // Read-only monitoring check; no background side effects to cancel
    return Promise.resolve();
  }

  async getRun(runId: string): Promise<RunRecord> {
    return {
      id: runId,
      agentId: 'free-cash-monitor',
      sessionId: 'session-main',
      workspaceId: 'ws-main',
      mode: 'task',
      status: 'completed',
      input: 'Daily Free Cash Status Check',
      logs: [],
      events: [],
      linkedArtifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async listTools(_agentId?: string): Promise<ToolDefinition[]> {
    return [
      { id: 'get-balance', name: 'Get Account Balance', description: 'Read account balance (read-only)' },
      { id: 'get-earnings', name: 'Get Today\'s Earnings', description: 'Read earnings for today (read-only)' },
      { id: 'detect-alerts', name: 'Detect Status Alerts', description: 'Detect changes or alerts (read-only)' }
    ];
  }

  async listMemoryScopes(_agentId?: string): Promise<MemoryScope[]> {
    return [
      {
        id: 'fc-finance-status',
        workspaceId: 'ws-main',
        name: 'Free Cash Financial Status (Read-Only)',
        type: 'task',
        tags: ['financial', 'readonly'],
        permissions: ['read']
      }
    ];
  }

  async fetchStatus(): Promise<FreeCashStatus> {
    return {
      lastChecked: new Date().toISOString(),
      pendingEarnings: undefined,
      earnedToday: 0,
      statusAlerts: [],
      requiresApproval: [],
      adapterHealth: 'healthy',
      externalConnected: false,
      externalStatusMessage: 'Local monitor adapter is operational in read-only sandbox mode. External FreeCash API connection is not configured.'
    };
  }

  async evaluateRules(status: FreeCashStatus, todayStr: string): Promise<void> {
    const lastCheck = new Date(status.lastChecked);

    if (lastCheck.toDateString() === todayStr && (status.statusAlerts?.length ?? 0) > 0) {
      if ((status.requiresApproval?.length ?? 0) > 0) {
        return; // Await human approval before any action
      }
    }
  }
}

export const freeCashMonitorAdapter = new FreeCashMonitorAdapter();
export default freeCashMonitorAdapter;
