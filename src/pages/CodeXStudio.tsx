import React, { useEffect, useState } from 'react';
import { StudioWorkspace } from '../components/codex/StudioWorkspace';
import { DiagnosticsDrawer } from '../components/codex/DiagnosticsDrawer';
import { useCodexStore } from '../store/codexStore';
import { isGoalActivelyRunning } from '../presenters/executionStatus';
import './codex-studio.css';
import { apiFetch } from '../api/client';
import ErrorBoundary from '../components/ErrorBoundary';

export default function CodeXStudio() {
  const {
    activeGoalId, setActiveGoalId,
    goalStatus, setGoalStatus,
    activeTab, setActiveTab,
    resetForNewTask
  } = useCodexStore();
  const [goals, setGoals] = useState<any[]>([]);

  const fetchGoals = async () => {
    try {
      const res = await apiFetch('/api/chat/agents/goals');
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setGoals(list);

      // Auto-hydrate activeGoalId ONLY if a goal is genuinely running right
      // now (a worker loop holds a live lease). A stale QUEUED goal with no
      // lease must NOT be auto-selected — it would make the studio appear
      // active forever and hide the SEND button.
      if (!activeGoalId) {
        const running = list.find((g: any) => isGoalActivelyRunning(g));
        if (running) setActiveGoalId(running.id);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchGoals();
    const interval = setInterval(fetchGoals, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeGoalId) {
      setGoalStatus(null);
      return;
    }
    const currentGoal = goals.find(g => g.id === activeGoalId);
    if (currentGoal) setGoalStatus(currentGoal.status);
  }, [activeGoalId, goals]);

  return (
    <ErrorBoundary name="CodeXStudio">
      <div className="codex-studio">
        <div className="codex-studio__body">
          <main data-testid="codex-workspace" className="codex-studio__workspace w-full flex-1 flex">
            <StudioWorkspace 
              activeGoalId={activeGoalId} 
              goalStatus={goalStatus}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              goals={goals}
              onSelectGoal={(id) => setActiveGoalId(id)}
              onNewGoal={() => resetForNewTask()}
              onGoalCreated={(id) => {
                setActiveGoalId(id);
                fetchGoals();
              }}
            />
          </main>
        </div>
        
        <DiagnosticsDrawer />
      </div>
    </ErrorBoundary>
  );
}
