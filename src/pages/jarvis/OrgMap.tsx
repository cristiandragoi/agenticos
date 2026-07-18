// @ts-nocheck
import React, { useState } from 'react';
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import { Layers, Users, Cpu, Monitor, GitBranch, Network } from 'lucide-react';
import AgentGraph from '../../components/ui/AgentGraph';

interface OrgNode {
  id: string;
  label: string;
  type: 'root' | 'runtime' | 'agent';
  status?: string;
  color?: string;
  children?: OrgNode[];
}

const OrgMap: React.FC = () => {
  const { agents, runtimes } = useData();
  const drawer = useDrawer();
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree');

  // Build tree from data
  const fleet = agents || [];
  const rtList = runtimes || [];

  const rootNode: OrgNode = {
    id: 'jarvis-root',
    label: 'Mission Control',
    type: 'root',
    color: '#38bdf8',
    children: rtList.map((rt: any) => ({
      id: rt.id,
      label: rt.label,
      type: 'runtime' as const,
      color: rt.health?.status === 'healthy' ? '#10b981' : '#ef4444',
      children: fleet
        .filter((a: any) => a.runtimeId === rt.id)
        .map((a: any) => ({
          id: a.id,
          label: a.name,
          type: 'agent' as const,
          status: a.status,
          color: a.color,
        })),
    })),
  };

  const activeAgentCount = fleet.filter((a: any) => a.status === 'active').length;

  const renderNode = (node: OrgNode, depth: number = 0) => {
    const isRoot = depth === 0;
    const isRuntime = node.type === 'runtime';
    const isAgent = node.type === 'agent';

    return (
      <div className="org-tree-node-wrapper" style={{ marginLeft: depth * 40 }}>
        <div
          className={`org-tree-node ${isRoot ? 'org-tree-node--root' : ''} ${isRuntime ? 'org-tree-node--runtime' : ''} ${isAgent && node.status === 'active' ? 'org-tree-node--active' : ''} ${isAgent && node.status === 'inactive' ? 'org-tree-node--sleeping' : ''}`}
          onClick={() => isAgent && drawer.open('agent', node.id)}
          style={isAgent ? { borderColor: node.color ? `${node.color}44` : undefined } : undefined}
        >
          <div className="org-tree-node__icon">
            {isRoot && <Layers size={16} />}
            {isRuntime && <Cpu size={14} />}
            {isAgent && <Users size={14} />}
          </div>
          <div className="org-tree-node__info">
            <div className="org-tree-node__label">{node.label}</div>
            {isAgent && (
              <div className="org-tree-node__status">
                <span
                  className="org-tree-node__dot"
                  style={{
                    backgroundColor: node.status === 'active' ? '#10b981' : '#6b7280',
                  }}
                />
                {node.status === 'active' ? 'ACTIVE' : 'SLEEPING'}
              </div>
            )}
          </div>
        </div>
        {/* Children with connector */}
        {node.children && node.children.length > 0 && (
          <div className="org-tree-children">
            {node.children.map((child) => (
              <div key={child.id} className="org-tree-child-wrapper">
                <div className="org-tree-connector" />
                {renderNode(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="jarvis-org-map">
      <div className="jarvis-org-map__header">
        <div>
          <h2>Organizational Map</h2>
          <p className="text-dim">Agent fleet hierarchy by runtime</p>
        </div>
        <div className="flex-row gap-3">
          <div className="segmented-tabs">
            <button
              className={`segmented-tab ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => setViewMode('tree')}
            >
              <GitBranch size={14} /> Tree
            </button>
            <button
              className={`segmented-tab ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
            >
              <Network size={14} /> Graph
            </button>
          </div>
          <div className="jarvis-org-map__stats">
            <Monitor size={14} />
            <span>{rtList.length} runtimes · {activeAgentCount} active agents</span>
          </div>
        </div>
      </div>
      <div className="jarvis-org-map__tree">
        {viewMode === 'tree' ? renderNode(rootNode) : (
          <div style={{ width: '100%', height: 520, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <AgentGraph
              agents={fleet}
              centerAgentId="agent-jarvis-core"
              onNodeClick={(id) => drawer.open('agent', id)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default OrgMap;