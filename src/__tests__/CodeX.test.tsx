import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StudioChat } from '../components/codex/StudioChat';
import { CodexProvider } from '../store/codexStore';
import { vi, describe, it, expect } from 'vitest';

describe('CodeX StudioChat Provider Configuration', () => {
  it('passes proper request-scoped provider and model', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ goalId: 'goal-123' })
    } as any);

    render(<CodexProvider><StudioChat activeGoalId={null} /></CodexProvider>);
    
    // Check that we render correctly
      expect(screen.getAllByText(/Repository:/).length).toBeGreaterThan(0);

    const input = screen.getByPlaceholderText(/What should CodeX do\?/i);
    fireEvent.change(input, { target: { value: 'Test plan' } });
    
    const sendButton = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/chat/agents/goal', expect.objectContaining({
        method: 'POST'
      }));
    });
    const targetCall = fetchSpy.mock.calls.find((call: any[]) => call[0] === '/api/chat/agents/goal');
    expect(targetCall).toBeDefined();
    
    const payload = JSON.parse(targetCall![1]?.body as string);
    expect(payload.goal).toBe('Test plan');
    expect(payload.agentId).toBe('agent-codex');
    expect(payload.executionOptions).toBeDefined();
    expect(payload.executionOptions.executionProviderId).toBe('auto');

    fetchSpy.mockRestore();
  });
});
