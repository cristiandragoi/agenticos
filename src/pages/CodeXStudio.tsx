import React, { useEffect, useState } from 'react';
import { StudioWorkspace } from '../components/codex/StudioWorkspace';
import { StudioInspector } from '../components/codex/StudioInspector';
import { StudioDrawer } from '../components/codex/StudioDrawer';

import { useCodexStore } from '../store/codexStore';
import './codex-studio.css';

export default function CodeXStudio() {
  const {
    activeGoalId, setActiveGoalId,
    goalStatus, setGoalStatus,
    activeTab, setActiveTab,
    isDrawerOpen, setIsDrawerOpen
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
    
    // Quick load initial status
    const currentGoal = goals.find(g => g.id === activeGoalId);
    if (currentGoal) setGoalStatus(currentGoal.status);
    
    const es = new EventSource(`/api/chat/agents/goal/stream/${activeGoalId}`);
    
    es.addEventListener('goal_event', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setGoalStatus(data.state);
        fetchGoals();
      } catch (err) {}
    });

    return () => es.close();
  }, [activeGoalId]);

  return (
    <div 
      className="codex-studio"
      style={{ '--drawer-height': isDrawerOpen ? '300px' : '40px' } as React.CSSProperties}
    >
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', background: '#3b82f6', color: '#fff', padding: '4px 12px', fontSize: '12px', fontWeight: 'bold', zIndex: 9999, borderBottomLeftRadius: '4px', borderBottomRightRadius: '4px' }}>
        Workspace CodeX UX v1.0
      </div>

      <div className="codex-studio__body">
        <main data-testid="codex-workspace" className="codex-studio__workspace w-full flex-1 flex">
          <StudioWorkspace 
            activeGoalId={activeGoalId} 
            goalStatus={goalStatus}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onGoalCreated={(id) => {
              setActiveGoalId(id);
              setIsDrawerOpen(true);
              fetchGoals();
            }}
          />
        </main>
        
        <div data-testid="codex-inspector" className="shrink-0 h-full overflow-hidden border-l border-[#30363d]">
          <StudioInspector activeGoalId={activeGoalId} />
        </div>
      </div>
      
      <div data-testid="codex-drawer" className="shrink-0 w-full overflow-hidden z-20">
        <StudioDrawer activeGoalId={activeGoalId} onClose={() => setIsDrawerOpen(false)} />
      </div>
    </div>
  );
}
