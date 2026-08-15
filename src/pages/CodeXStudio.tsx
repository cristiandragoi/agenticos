import React, { useEffect, useState } from 'react';
import { StudioWorkspace } from '../components/codex/StudioWorkspace';
import { DiagnosticsDrawer } from '../components/codex/DiagnosticsDrawer';
import { useCodexStore } from '../store/codexStore';
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

      // Auto-hydrate activeGoalId if null and goals exist
      if (!activeGoalId && list.length > 0) {
        // Prefer any currently active/running goal, or most recent goal
        const running = list.find((g: any) => ['queued', 'planning', 'executing', 'reasoning', 'retrying'].includes(g.status));
        setActiveGoalId((running || list[0]).id);
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
