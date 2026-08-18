import React from 'react';
import { CodeXChat } from './CodeXChat';
import { StudioPlan } from './StudioPlan';
import { StudioFiles } from './StudioFiles';
import { StudioFileList } from './StudioFileList';
import { MessageSquare, LayoutList, FolderCode, GitCompare } from 'lucide-react';

interface Props {
  activeGoalId: string | null;
  goalStatus: string | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onGoalCreated?: (id: string) => void;
}

export const CodeXWorkspace: React.FC<Props> = ({ activeGoalId, goalStatus, activeTab, setActiveTab, onGoalCreated }) => {
  const tabs = [
    { id: 'chat', label: 'Conversation', icon: <MessageSquare size={14} /> },
    { id: 'plan', label: 'Plan', icon: <LayoutList size={14} /> },
    { id: 'files', label: 'Files', icon: <FolderCode size={14} /> },
    { id: 'diff', label: 'Diff', icon: <GitCompare size={14} /> },
  ];

  return (
    <div className="codex-workspace">
      <div className="codex-workspace__header">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`codex-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>
      
      <div className="codex-workspace__content">
        {activeTab === 'chat' && <CodeXChat activeGoalId={activeGoalId} onGoalCreated={onGoalCreated!} />}
        {activeTab === 'plan' && <StudioPlan activeGoalId={activeGoalId} />}
        {activeTab === 'files' && <StudioFileList activeGoalId={activeGoalId} />}
        {activeTab === 'diff' && <StudioFiles activeGoalId={activeGoalId} />}
      </div>
    </div>
  );
};
