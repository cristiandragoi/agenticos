import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatActionStatusCard, type ActionStatusData } from '../components/jarvis/ChatActionStatusCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatActionStatusCard Recovery Approval UI', () => {
  const proposal = {
    incidentId: 'INC-VOICE-001',
    problem: 'Browser failed to navigate to YouTube',
    diagnosis: 'Navigation timeout due to missing host verification',
    proposedRepair: 'Add host verification and error handling in browserOperator',
    filesAffected: ['src/services/browserOperator.ts'],
    testResult: { passed: true, suiteName: 'browserVerification' },
    risk: 'low' as const,
    patch: 'diff --git a/src/services/browserOperator.ts b/src/services/browserOperator.ts\n--- a/src/services/browserOperator.ts\n+++ b/src/services/browserOperator.ts\n@@ -10,3 +10,4 @@\n-const host = "";\n+const host = "youtube.com";\n',
  };

  it('renders standard Action Center card for regular capability execution', () => {
    const data: ActionStatusData = {
      actionName: 'Open YouTube',
      targetCapability: 'browser',
      status: 'completed',
      currentStep: 'All steps completed',
      request: 'Open YouTube',
      understood: 'Open YouTube in browser',
    };

    render(<ChatActionStatusCard data={data} />);

    expect(screen.getByTestId('chat-action-status-card')).toBeTruthy();
    expect(screen.getByText('Open YouTube')).toBeTruthy();
    expect(screen.getByText('COMPLETED')).toBeTruthy();
    // Repair approval section must NOT be present when no repair is proposed
    expect(screen.queryByTestId('repair-approval-section')).toBeNull();
  });

  it('Phase 2: Renders dedicated recovery approval section when repair is proposed', () => {
    const data: ActionStatusData = {
      actionName: 'Open YouTube',
      targetCapability: 'browser',
      status: 'waiting',
      stage: 'AWAITING_APPROVAL',
      currentStep: 'Repair prepared — approval required',
      repairProposal: proposal,
    };

    render(<ChatActionStatusCard data={data} />);

    expect(screen.getByTestId('repair-approval-section')).toBeTruthy();
    expect(screen.getByText('Self-Heal Recovery Proposal')).toBeTruthy();
    expect(screen.getByText('INC-VOICE-001')).toBeTruthy();
    expect(screen.getByText('Browser failed to navigate to YouTube')).toBeTruthy();
    expect(screen.getByText('Navigation timeout due to missing host verification')).toBeTruthy();
    expect(screen.getByText('Add host verification and error handling in browserOperator')).toBeTruthy();
    expect(screen.getByText('src/services/browserOperator.ts')).toBeTruthy();
    expect(screen.getByText('Isolated Verification Passed')).toBeTruthy();
    expect(screen.getByText('Risk: low')).toBeTruthy();

    // Verify Action buttons
    expect(screen.getByTestId('inspect-diff-button')).toBeTruthy();
    expect(screen.getByTestId('approve-repair-button')).toBeTruthy();
    expect(screen.getByTestId('reject-repair-button')).toBeTruthy();

    // Verify Timeline
    expect(screen.getByTestId('repair-timeline')).toBeTruthy();
    expect(screen.getByText('Original action failed')).toBeTruthy();
    expect(screen.getByText('Repair tests passed')).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
  });

  it('Phase 3: Inspect Diff toggles and renders actual unified diff with additions and removals', () => {
    const data: ActionStatusData = {
      actionName: 'Open YouTube',
      targetCapability: 'browser',
      status: 'waiting',
      stage: 'AWAITING_APPROVAL',
      repairProposal: proposal,
    };

    render(<ChatActionStatusCard data={data} />);

    // Initially diff viewer is closed
    expect(screen.queryByTestId('diff-viewer')).toBeNull();

    // Click Inspect Diff button
    fireEvent.click(screen.getByTestId('inspect-diff-button'));

    // Now diff viewer is open
    expect(screen.getByTestId('diff-viewer')).toBeTruthy();
    expect(screen.getAllByText('src/services/browserOperator.ts').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByText('+const host = "youtube.com";')).toBeTruthy();
    expect(screen.getByText('-const host = "";')).toBeTruthy();

    // Toggle close
    fireEvent.click(screen.getByTestId('inspect-diff-button'));
    expect(screen.queryByTestId('diff-viewer')).toBeNull();
  });

  it('Phase 5 & 10: Approving repair calls API and displays progressive recovery lifecycle', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        status: 'recovered',
        message: 'The repair was applied successfully and verified. I retried your request, and YouTube is open now.',
        incidentId: 'INC-VOICE-001',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const data: ActionStatusData = {
      actionName: 'Open YouTube',
      targetCapability: 'browser',
      status: 'waiting',
      stage: 'AWAITING_APPROVAL',
      repairProposal: proposal,
      conversationId: 'conv-test-1',
    };

    render(<ChatActionStatusCard data={data} />);

    const approveBtn = screen.getByTestId('approve-repair-button');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jarvis/self-heal/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            incidentId: 'INC-VOICE-001',
            conversationId: 'conv-test-1',
            approver: 'user',
          }),
        }),
      );
    });

    // Timeline updates to Recovered and displays natural final response
    expect(await screen.findByText('Recovered')).toBeTruthy();
    expect(
      screen.getByText('The repair was applied successfully and verified. I retried your request, and YouTube is open now.'),
    ).toBeTruthy();
  });

  it('Phase 11: Rejecting repair calls API and marks state as rejected leaving system unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        status: 'rejected',
        message: 'I left the system unchanged. The proposed repair was rejected.',
        incidentId: 'INC-VOICE-001',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const data: ActionStatusData = {
      actionName: 'Open YouTube',
      targetCapability: 'browser',
      status: 'waiting',
      stage: 'AWAITING_APPROVAL',
      repairProposal: proposal,
      conversationId: 'conv-test-1',
    };

    render(<ChatActionStatusCard data={data} />);

    const rejectBtn = screen.getByTestId('reject-repair-button');
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jarvis/self-heal/reject',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            incidentId: 'INC-VOICE-001',
            conversationId: 'conv-test-1',
            reason: 'Rejected by user',
          }),
        }),
      );
    });

    expect(await screen.findByText('Repair rejected by user')).toBeTruthy();
    expect(screen.getByText('I left the system unchanged. The proposed repair was rejected.')).toBeTruthy();
  });
});
