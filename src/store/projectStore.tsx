// @ts-nocheck
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  tags?: string[];
  workspacePath?: string | null;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  projectId: string;
  title: string;
  content: string;
  type: string;
  tags?: string[];
  linkedIds?: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isLoading: boolean;
  refresh: () => void;
  setActiveProject: (id: string | null) => Promise<void>;
  createProject: (data: { name: string; description?: string; tags?: string[]; color?: string }) => Promise<Project | null>;
  updateProject: (id: string, data: Partial<Project>) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  getKnowledgeItems: (projectId: string) => Promise<KnowledgeItem[]>;
  createKnowledgeItem: (projectId: string, data: { title: string; content?: string; type?: string; tags?: string[] }) => Promise<KnowledgeItem | null>;
  updateKnowledgeItem: (projectId: string, id: string, data: Partial<KnowledgeItem>) => Promise<KnowledgeItem | null>;
  deleteKnowledgeItem: (projectId: string, id: string) => Promise<void>;
  getProjectTasks: (projectId: string) => Promise<any[]>;
}

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await apiFetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects || []);
      setActiveProjectId(data.activeProjectId ?? null);
    } catch {
      // best effort
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const setActiveProject = async (id: string | null) => {
    try {
      await apiFetch('/api/projects/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id }),
      });
      setActiveProjectId(id);
      // Re-sync the full project list from the server so any external change
      // (a project switched from another page or process) is reflected.
      void fetchProjects();
    } catch { /* best effort */ }
  };

  const createProject = async (data: { name: string; description?: string; tags?: string[]; color?: string }) => {
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      const project = await res.json();
      setProjects((prev) => [project, ...prev]);
      return project;
    } catch { return null; }
  };

  const updateProject = async (id: string, data: Partial<Project>) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      const project = await res.json();
      setProjects((prev) => prev.map((p) => (p.id === id ? project : p)));
      return project;
    } catch { return null; }
  };

  const deleteProject = async (id: string) => {
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) setActiveProjectId(null);
    } catch { /* best effort */ }
  };

  const getKnowledgeItems = async (projectId: string): Promise<KnowledgeItem[]> => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/knowledge`);
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  };

  const createKnowledgeItem = async (
    projectId: string,
    data: { title: string; content?: string; type?: string; tags?: string[] },
  ): Promise<KnowledgeItem | null> => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  };

  const updateKnowledgeItem = async (
    projectId: string,
    id: string,
    data: Partial<KnowledgeItem>,
  ): Promise<KnowledgeItem | null> => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/knowledge/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  };

  const deleteKnowledgeItem = async (projectId: string, id: string): Promise<void> => {
    try {
      await apiFetch(`/api/projects/${projectId}/knowledge/${id}`, { method: 'DELETE' });
    } catch { /* best effort */ }
  };

  const getProjectTasks = async (projectId: string): Promise<any[]> => {
    try {
      const res = await apiFetch(`/api/background-tasks?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        activeProjectId,
        activeProject,
        isLoading,
        refresh: fetchProjects,
        setActiveProject,
        createProject,
        updateProject,
        deleteProject,
        getKnowledgeItems,
        createKnowledgeItem,
        updateKnowledgeItem,
        deleteKnowledgeItem,
        getProjectTasks,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
}
