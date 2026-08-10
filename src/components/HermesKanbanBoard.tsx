import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Calendar, Check, X } from 'lucide-react';
import { DndContext, closestCenter, useDroppable, useDraggable } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { useHermesStore } from '../store/hermesStore';
import type { HermesTask, HermesTaskStatus } from '../store/hermesStore';
import type { AgentSkill } from '../../shared/types/skill';
import { apiFetch, apiUrl } from '../api/client';

interface HermesKanbanBoardProps {}

const HermesKanbanBoard: React.FC<HermesKanbanBoardProps> = () => {
  const { moveTask, setAllTasks } = useHermesStore();
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [selectedTask, setSelectedTask] = useState<HermesTask | null>(null);

  useEffect(() => {
    apiFetch('/api/skills')
      .then(res => res.json())
      .then(data => setSkills(data || []))
      .catch(console.error);
      
    apiFetch('/api/tasks')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setAllTasks(data);
      })
      .catch(console.error);
  }, [setAllTasks]);
  
  const columns: { id: HermesTaskStatus; name: string }[] = [
    { id: 'backlog', name: 'Backlog' },
    { id: 'in_progress', name: 'In Progress' },
    { id: 'review', name: 'Review' },
    { id: 'done', name: 'Done' }
  ];

  function onDragEnd(e: DragEndEvent) {
    const overLaneId = e.over?.id?.toString().split(':')[1];
    if (!overLaneId) return;
    const cardId = e.active.id.toString().split(':')[1];
    if (!cardId) return;
    moveTask(cardId, overLaneId as HermesTaskStatus);
    
    // Optimistic update to backend
    apiFetch(`/api/tasks/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: overLaneId })
    }).catch(console.error);
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex gap-4 h-full overflow-x-auto pb-4 relative">
        {columns.map((c) => (
          <HermesKanbanColumnView key={c.id} column={c} skills={skills} onCardClick={setSelectedTask} />
        ))}
        {selectedTask && (
          <TaskModal 
            task={selectedTask} 
            skills={skills} 
            onClose={() => setSelectedTask(null)} 
          />
        )}
      </div>
    </DndContext>
  );
};

function HermesKanbanColumnView({ column, skills, onCardClick }: { column: { id: HermesTaskStatus, name: string }, skills: AgentSkill[], onCardClick: (t: HermesTask) => void }) {
  const { tasks } = useHermesStore();
  const columnTasks = tasks.filter(t => t.status === column.id);
  const { setNodeRef } = useDroppable({ id: `lane:${column.id}` });

  return (
    <div className="board-column">
      <div className="board-column__header">
        <h3 className="board-column__title">{column.name}</h3>
        <span className="board-column__count">{columnTasks.length}</span>
      </div>
      <div className="board-column__body" ref={setNodeRef} id={`lane:${column.id}`} data-droppable="true">
        {columnTasks.map((card) => <HermesCard key={card.id} card={card} skills={skills} onClick={() => onCardClick(card)} />)}
        {columnTasks.length === 0 && (
          <div className="board-column__empty">Drop task here</div>
        )}
      </div>
    </div>
  );
}

function HermesCard({ card, skills, onClick }: { card: HermesTask, skills: AgentSkill[], onClick?: () => void }) {
  const { updateTaskStatus, updateTaskSchedule, addRunLog } = useHermesStore();
  const [executing, setExecuting] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  
  const [showSchedule, setShowSchedule] = useState(false);
  const [cronPreset, setCronPreset] = useState<string>(card.schedule?.cronExpression || '0 9 * * *');
  const [selectedSkillId, setSelectedSkillId] = useState<string>(card.skillId || 'daily-briefing');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `card:${card.id}`,
  });
  
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 50,
  } : undefined;

  const handleScheduleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingSchedule(true);
    try {
      const isUpdate = !!card.schedule?.id;
      const url = isUpdate ? `/api/schedules/${card.schedule!.id}` : `/api/schedules`;
      const method = isUpdate ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: card.id,
          skillId: selectedSkillId,
          cronExpression: cronPreset,
          active: true
        })
      });
      
      if (!res.ok) throw new Error('Failed to save schedule');
      const data = await res.json();
      
      updateTaskSchedule(card.id, {
        id: isUpdate ? card.schedule!.id : data.id,
        cronExpression: cronPreset,
        active: true
      });
      setShowSchedule(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleExecute = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExecuting(true);
    setResultText(null);
    updateTaskStatus(card.id, 'in_progress');
    
    try {
      const res = await apiFetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          taskId: card.id, 
          skillId: selectedSkillId,
          triggerType: 'manual'
        }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to enqueue run');
      }
      
      const data = await res.json();
      
      const finalReply = `Run successfully queued in SQLite Engine!\nRun ID: ${data.id}`;
      setResultText(finalReply);
      addRunLog(card.id, finalReply);
    } catch (e: any) {
      setResultText('Failed to start run');
      updateTaskStatus(card.id, 'backlog');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, '--card-accent': 'var(--color-hermes)' } as React.CSSProperties}
      id={`card:${card.id}`}
      className={`entity-card ${card.status === 'in_progress' && executing ? 'animate-pulse' : ''} cursor-pointer`}
      onClick={onClick}
    >
      <div className="entity-card__header">
        <div className="entity-card__identity">
          <div 
            {...listeners} 
            {...attributes} 
            className="cursor-grab text-dim hover:text-primary" 
            title="Drag task"
          >
            &#x2630;
          </div>
          <div>
            <div className="entity-card__title">{card.title}</div>
            <div className="entity-card__subtitle">{card.agent || 'Hermes'}</div>
          </div>
        </div>
      </div>

      {card.description && (
        <div className="entity-card__body">{card.description}</div>
      )}

      <div className="entity-card__meta">
        <div className="status-pill">
          {card.skillId || 'No Skill'}
        </div>
      </div>

      <div className="flex-row gap-2 mt-3" style={{ marginTop: '12px' }}>
        {card.status !== 'in_progress' && card.status !== 'done' && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setShowSchedule(!showSchedule); }}
              disabled={executing}
              className="search-trigger"
              style={{ background: card.schedule?.active ? 'var(--color-info-bg)' : undefined }}
            >
              <Calendar size={12} /> Schedule
            </button>
            <button
              onClick={handleExecute}
              disabled={executing}
              className="search-trigger"
              style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}
            >
              Run
            </button>
          </>
        )}
      </div>

      {card.schedule?.active && !showSchedule && (
        <div className="text-xs text-info mt-2 flex-row gap-1" style={{ color: 'var(--color-info)' }}>
          <Clock size={10} /> On Schedule: {card.schedule.cronExpression}
        </div>
      )}

      {showSchedule && (
        <div className="mt-2 p-2" style={{ backgroundColor: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginTop: '8px' }}>
          <div className="flex-row justify-between mb-2">
            <span className="text-xs">Automation Schedule</span>
            <button onClick={(e) => { e.stopPropagation(); setShowSchedule(false); }} className="text-dim hover:text-primary" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={12}/></button>
          </div>
          <div className="flex-col gap-2 mb-2">
            <label className="nav-section-label" style={{ padding: 0 }}>Attached Skill</label>
            <select 
              value={selectedSkillId}
              onChange={(e) => setSelectedSkillId(e.target.value)}
              className="chat-dock__input text-xs" style={{ padding: '4px 8px' }}
              onClick={e => e.stopPropagation()}
            >
              <option value="" disabled>Select a Skill...</option>
              {skills.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-col gap-2 mb-2">
            <label className="nav-section-label" style={{ padding: 0 }}>Cron Trigger</label>
            <select 
              value={cronPreset} 
              onChange={(e) => setCronPreset(e.target.value)}
              className="chat-dock__input text-xs" style={{ padding: '4px 8px' }}
              onClick={e => e.stopPropagation()}
            >
              <option value="* * * * *">Every minute (testing)</option>
              <option value="0 * * * *">Every hour</option>
              <option value="0 9 * * *">Every day at 9:00 AM</option>
              <option value="0 9 * * 1">Every Monday at 9:00 AM</option>
            </select>
          </div>
          <div className="flex-row justify-between">
            <div />
            <button
              onClick={handleScheduleSave}
              disabled={savingSchedule}
              className="search-trigger" style={{ background: 'var(--color-info)', color: '#fff' }}
            >
              {savingSchedule ? 'Saving...' : <><Check size={10}/> Save</>}
            </button>
          </div>
        </div>
      )}

      {resultText && (
        <div className="text-xs mt-2 p-2" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflowY: 'auto' }}>
          {resultText}
        </div>
      )}
    </div>
  );
}
function TaskModal({ task, skills, onClose }: { task: HermesTask, skills: AgentSkill[], onClose: () => void }) {
  const { updateTaskStatus } = useHermesStore();
  const [executing, setExecuting] = useState(false);

  const handleExecute = async () => {
    setExecuting(true);
    updateTaskStatus(task.id, 'in_progress');
    try {
      await apiFetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          taskId: task.id, 
          skillId: task.skillId || 'daily-briefing',
          triggerType: 'manual'
        }),
      });
    } catch (e) {
      updateTaskStatus(task.id, 'backlog');
    } finally {
      setExecuting(false);
      onClose();
    }
  };

  const modalContent = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-overlay)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', width: '100%', maxWidth: '500px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-elevated)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Task Details</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Title</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '16px' }}>{task.title}</div>
          </div>
          <div>
            <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Description</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', whiteSpace: 'pre-wrap', backgroundColor: 'var(--bg-base)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>{task.description || 'No description provided.'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Status</div>
              <div style={{ color: 'var(--text-secondary)', textTransform: 'capitalize', fontSize: '14px' }}>{task.status.replace('_', ' ')}</div>
            </div>
            <div>
              <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Skill</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{skills.find(s => s.id === task.skillId)?.name || task.skillId || 'None'}</div>
            </div>
            <div>
              <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Schedule</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{task.schedule?.active ? task.schedule.cronExpression : 'Not scheduled'}</div>
            </div>
            <div>
              <div className="nav-section-label" style={{ padding: 0, marginBottom: '4px' }}>Assigned Agent</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{task.agent || 'Hermes'}</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={onClose} className="search-trigger" style={{ padding: '8px 16px', border: '1px solid var(--border-subtle)', backgroundColor: 'transparent' }}>
            Edit
          </button>
          <button onClick={handleExecute} disabled={executing} className="search-trigger" style={{ padding: '8px 16px', backgroundColor: 'var(--color-success)', color: '#fff' }}>
            {executing ? 'Starting...' : 'Run now'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

export default HermesKanbanBoard;

