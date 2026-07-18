import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

export type HermesTaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';

export interface HermesTask {
  id: string;
  title: string;
  description?: string;
  status: HermesTaskStatus;
  createdAt: string;
  updatedAt?: string;
  // Existing internal fields
  agent: string;
  model: string;
  fallbackApplied?: boolean;
  fallbackReason?: string;
  runLogs?: string[];
  
  // Milestone 3: Scheduling
  schedule?: {
    id?: string;
    cronExpression?: string;
    timezone?: string;
    active?: boolean;
  };
  skillId?: string;
}

interface HermesState {
  tasks: HermesTask[];
  setAllTasks: (tasks: HermesTask[]) => void;
  addTask: (task: Omit<HermesTask, 'id' | 'createdAt'>) => void;
  updateTaskStatus: (id: string, status: HermesTaskStatus) => void;
  updateTaskSchedule: (id: string, schedule: HermesTask['schedule']) => void;
  moveTask: (cardId: string, toLaneId: string) => void;
  addRunLog: (id: string, log: string) => void;
  getStats: () => Record<HermesTaskStatus, number>;
}

const initialTasks: HermesTask[] = [];

const HermesContext = createContext<HermesState | null>(null);

export const HermesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<HermesTask[]>(initialTasks);

  const setAllTasks = useCallback((newTasks: HermesTask[]) => {
    setTasks(newTasks);
  }, []);

  const addTask = useCallback((task: Omit<HermesTask, 'id' | 'createdAt'>) => {
    setTasks(prev => [{ ...task, id: `t${Date.now()}`, createdAt: new Date().toISOString() }, ...prev]);
  }, []);

  const updateTaskStatus = useCallback((id: string, status: HermesTaskStatus) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t));
  }, []);

  const updateTaskSchedule = useCallback((id: string, schedule: HermesTask['schedule']) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, schedule, updatedAt: new Date().toISOString() } : t));
  }, []);

  const moveTask = useCallback((cardId: string, toLaneId: string) => {
    let newStatus: HermesTaskStatus = 'backlog';
    if (toLaneId.includes('inprogress') || toLaneId === 'in_progress' || toLaneId === 'in-progress') newStatus = 'in_progress';
    else if (toLaneId.includes('review') || toLaneId === 'review') newStatus = 'review';
    else if (toLaneId.includes('done') || toLaneId === 'done') newStatus = 'done';
    else if (toLaneId === 'backlog') newStatus = 'backlog';

    setTasks(prev => prev.map(t => t.id === cardId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t));
  }, []);

  const addRunLog = useCallback((id: string, log: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        return { ...t, runLogs: [...(t.runLogs || []), log], updatedAt: new Date().toISOString() };
      }
      return t;
    }));
  }, []);

  const getStats = useCallback(() => {
    return {
      'backlog': tasks.filter(t => t.status === 'backlog').length,
      'in_progress': tasks.filter(t => t.status === 'in_progress').length,
      'review': tasks.filter(t => t.status === 'review').length,
      'done': tasks.filter(t => t.status === 'done').length,
    };
  }, [tasks]);

  return (
    <HermesContext.Provider value={{ tasks, setAllTasks, addTask, updateTaskStatus, updateTaskSchedule, moveTask, addRunLog, getStats }}>
      {children}
    </HermesContext.Provider>
  );
};

export const useHermesStore = () => {
  const ctx = useContext(HermesContext);
  if (!ctx) throw new Error('useHermesStore must be used within HermesProvider');
  return ctx;
};
