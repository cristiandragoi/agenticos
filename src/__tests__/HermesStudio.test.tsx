import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import HermesKanbanView from '../pages/HermesKanbanView';

// Mock the hooks to isolate the component
vi.mock('../hooks/useChatManager', () => ({
  useChatManager: () => ({
    sendMessage: vi.fn(),
    isTyping: false
  })
}));

vi.mock('../components/HermesKanbanBoard', () => ({
  default: () => <div data-testid="kanban-board">Board</div>
}));

vi.mock('../components/HermesContextPanel', () => ({
  default: () => <div data-testid="context-panel">Panel</div>
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

describe('HermesKanbanView Parent Re-render', () => {
  it('updates input value and persists across parent re-renders', () => {
    let forceRender: any;
    
    const Parent = () => {
      const [count, setCount] = useState(0);
      forceRender = () => setCount(c => c + 1);
      
      return (
        <div>
          <span data-testid="count">{count}</span>
          <HermesKanbanView />
        </div>
      );
    };

    render(<Parent />);
    
    const input = screen.getByPlaceholderText('Ask anything or request a task...');
    expect(input).toBeInTheDocument();
    
    // Type into input
    fireEvent.change(input, { target: { value: 'test task' } });
    expect(input).toHaveValue('test task');
    
    // Force parent re-render
    forceRender();
    
    // Check if input value is preserved
    expect(input).toHaveValue('test task');
  });
});
