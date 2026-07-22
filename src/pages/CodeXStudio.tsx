import React, { useEffect, useState } from 'react';
import { StudioWorkspace } from '../components/codex/StudioWorkspace';
import { DiagnosticsDrawer } from '../components/codex/DiagnosticsDrawer';

import { useCodexStore } from '../store/codexStore';
import './codex-studio.css';

export default function CodeXStudio() {
  const {
    activeGoalId, setActiveGoalId,
    goalStatus, setGoalStatus,
    activeTab, setActiveTab
  } = useCodexStore();
  const [goals, setGoals] = useState<any[]>([]);

  const fetchGoals = async () => {
    try {
      const res = await fetch('/api/chat/agents/goals');
      const data = await res.json();
      setGoals(data || []);
    } catch (e) {}
  };

  useEffect(() => {
    fetchGoals();
    const interval = setInterval(fetchGoals, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeGoalId) {
      setGoalStatus(null);
      return;
    }
    // Initial status from the goals list; live updates arrive via the
    // workspace event stream, which owns the SSE connection.
    const currentGoal = goals.find(g => g.id === activeGoalId);
    if (currentGoal) setGoalStatus(currentGoal.status);
  }, [activeGoalId, goals]);

  return (
    <div className="codex-studio">
      <div className="codex-studio__body">
        <main data-testid="codex-workspace" className="codex-studio__workspace w-full flex-1 flex">
          <StudioWorkspace 
            activeGoalId={activeGoalId} 
            goalStatus={goalStatus}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onGoalCreated={(id) => {
              setActiveGoalId(id);
              fetchGoals();
            }}
          />
        </main>
      </div>
      
      <DiagnosticsDrawer />
    </div>
  );
}
