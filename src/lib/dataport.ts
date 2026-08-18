import { useState, useEffect } from "react";

import { apiFetch, apiUrl } from '../api/client';
const API_BASE = apiUrl('/api');

export function useBoards() {
  const [boards, setBoards] = useState([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/kanban/boards`).then(res => res.json()).then(setBoards);
  }, []);
  return boards;
}

export function useColumns(boardId: string | undefined) {
  const [columns, setColumns] = useState([]);
  useEffect(() => {
    if (!boardId) return;
    apiFetch(`${API_BASE}/kanban/boards/${boardId}/columns`).then(res => res.json()).then(setColumns);
  }, [boardId]);
  return columns;
}

export function useLanes(columnId: string | undefined) {
  const [lanes, setLanes] = useState([]);
  useEffect(() => {
    if (!columnId) return;
    apiFetch(`${API_BASE}/kanban/columns/${columnId}/lanes`).then(res => res.json()).then(setLanes);
  }, [columnId]);
  return lanes;
}

export function useCards(laneId: string | undefined) {
  const [cards, setCards] = useState<any[]>([]);
  useEffect(() => {
    if (!laneId) return;
    apiFetch(`${API_BASE}/kanban/lanes/${laneId}/cards`).then(res => res.json()).then(setCards);
  }, [laneId]);
  
  // We attach a reload function so mutations can force a refresh if needed
  // (In a real app we'd use SWR or React Query)
  const reload = () => {
    apiFetch(`${API_BASE}/kanban/lanes/${laneId}/cards`).then(res => res.json()).then(setCards);
  };
  
  return Object.assign(cards, { reload });
}

export function useRun(runId: string | undefined) {
  const [run, setRun] = useState<any>(null);
  useEffect(() => {
    if (!runId) return;
    const fetchRun = () => apiFetch(`${API_BASE}/kanban/runs/${runId}`).then(res => res.json()).then(setRun);
    fetchRun();
    const interval = setInterval(fetchRun, 2000); // simple polling
    return () => clearInterval(interval);
  }, [runId]);
  return run;
}

export function useKanbanMutations() {
  return {
    createBoard: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    createColumn: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    createLane: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/lanes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    createCard: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    moveCard: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/cards/${data.cardId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toLaneId: data.toLaneId, toOrder: data.toOrder })
      });
      return res.json();
    },
    updateLaneConfig: async (laneId: string, config: any) => {
      const res = await apiFetch(`${API_BASE}/kanban/lanes/${laneId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      return res.json();
    },

    /** Execute a card through the backend kanban adapter pipeline. Returns { runId, cardId }. */
    executeCard: async (cardId: string, prompt: string) => {
      const res = await apiFetch(`${API_BASE}/kanban/cards/${cardId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      return res.json();
    },

    /** Dispatch a card through its lane's gateway pipeline. Returns { runId }. */
    runCard: async (payload: {
      cardId: string;
      laneId: string;
      laneKind: string;
      laneConfig: Record<string, unknown>;
      cardTitle: string;
      cardBody: string;
    }) => {
      const res = await apiFetch(`${API_BASE}/dispatch/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.json();
    },
  };
}

export function useRevenueIntelligenceSummary() {
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    apiFetch(`${API_BASE}/revenue/intelligence/summary`)
      .then(res => res.json())
      .then(setSummary)
      .catch(console.error);
  }, []);
  return summary;
}

export function useRevenueIntelligenceAgents() {
  const [agents, setAgents] = useState<any[]>([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/revenue/intelligence/agents`)
      .then(res => res.json())
      .then(setAgents)
      .catch(console.error);
  }, []);
  return agents;
}

export function useRevenueIntelligencePrompts() {
  const [prompts, setPrompts] = useState<any[]>([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/revenue/intelligence/prompts`)
      .then(res => res.json())
      .then(setPrompts)
      .catch(console.error);
  }, []);
  return prompts;
}

export function useRevenueIntelligenceCampaigns() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/revenue/intelligence/campaigns`)
      .then(res => res.json())
      .then(setCampaigns)
      .catch(console.error);
  }, []);
  return campaigns;
}

