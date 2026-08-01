import { 
  DataPort, Board, Column, Lane, Card, Run, 
  NewLane, NewCard, NewRun, Id, CardState 
} from '../core/dataport/index.js';

// In-memory data store to replace Convex
// Helper to generate IDs
const generateId = (): Id => Math.random().toString(36).substring(2, 15);

let boards: Board[] = [
  { id: 'b-main', name: 'Mission Control', createdAt: Date.now() },
  { id: 'b-welders', name: 'Workers Placement Leads', description: 'Pipeline for welder/electrician placements in DE/NL', createdAt: Date.now() },
  { id: 'b-sales', name: 'Agentic OS CRM Sales', description: 'Pipeline for selling Agentic OS + Muncade', createdAt: Date.now() },
  { id: 'b-hermes', name: 'Hermes Workspace', description: 'Primary orchestrator for the Agentic OS', createdAt: Date.now() }
];
let columns: Column[] = [
  { id: 'c-1', boardId: 'b-main', name: 'Backlog', order: 0 },
  { id: 'c-2', boardId: 'b-main', name: 'In Progress', order: 1 },
  { id: 'c-3', boardId: 'b-main', name: 'Done', order: 2 },
  { id: 'c-welders-backlog', boardId: 'b-welders', name: 'Backlog', order: 0 },
  { id: 'c-welders-inprogress', boardId: 'b-welders', name: 'In Progress', order: 1 },
  { id: 'c-welders-done', boardId: 'b-welders', name: 'Done', order: 2 },
  { id: 'c-sales-backlog', boardId: 'b-sales', name: 'Backlog', order: 0 },
  { id: 'c-sales-inprogress', boardId: 'b-sales', name: 'In Progress', order: 1 },
  { id: 'c-sales-done', boardId: 'b-sales', name: 'Done', order: 2 },
  { id: 'c-hermes-backlog', boardId: 'b-hermes', name: 'Backlog', order: 0 },
  { id: 'c-hermes-inprogress', boardId: 'b-hermes', name: 'In Progress', order: 1 },
  { id: 'c-hermes-review', boardId: 'b-hermes', name: 'Review', order: 2 },
  { id: 'c-hermes-blocked', boardId: 'b-hermes', name: 'Blocked', order: 3 },
  { id: 'c-hermes-done', boardId: 'b-hermes', name: 'Done', order: 4 }
];
let lanes: Lane[] = [
  { id: 'l-hermes', columnId: 'c-2', name: 'Hermes', kind: 'hermes', config: { targetAgentId: 'agent-hermes' }, order: 0 },
  { id: 'l-jarvis', columnId: 'c-2', name: 'Jarvis', kind: 'http', config: { endpoint: 'http://localhost:4000/api/dispatch', method: 'POST' }, order: 1 },
  { id: 'l-welders-backlog', columnId: 'c-welders-backlog', name: 'To Contact', kind: 'http', config: {}, order: 0 },
  { id: 'l-welders-inprogress', columnId: 'c-welders-inprogress', name: 'Negotiating', kind: 'http', config: {}, order: 0 },
  { id: 'l-welders-done', columnId: 'c-welders-done', name: 'Placed', kind: 'http', config: {}, order: 0 },
  { id: 'l-sales-backlog', columnId: 'c-sales-backlog', name: 'Leads', kind: 'http', config: {}, order: 0 },
  { id: 'l-sales-inprogress', columnId: 'c-sales-inprogress', name: 'Demo Scheduled', kind: 'http', config: {}, order: 0 },
  { id: 'l-sales-done', columnId: 'c-sales-done', name: 'Closed', kind: 'http', config: {}, order: 0 },
  { id: 'l-hermes-backlog', columnId: 'c-hermes-backlog', name: 'Backlog', kind: 'hermes', config: { targetAgentId: 'agent-hermes' }, order: 0 },
  { id: 'l-hermes-inprogress-hermes', columnId: 'c-hermes-inprogress', name: 'Hermes', kind: 'hermes', config: { targetAgentId: 'agent-hermes' }, order: 0 },
  { id: 'l-hermes-inprogress-jarvis', columnId: 'c-hermes-inprogress', name: 'Jarvis', kind: 'http', config: { endpoint: 'http://localhost:4000/api/dispatch', method: 'POST' }, order: 1 },
  { id: 'l-hermes-inprogress-welders', columnId: 'c-hermes-inprogress', name: 'Welders', kind: 'http', config: {}, order: 2 },
  { id: 'l-hermes-review', columnId: 'c-hermes-review', name: 'Review', kind: 'hermes', config: {}, order: 0 },
  { id: 'l-hermes-blocked', columnId: 'c-hermes-blocked', name: 'Blocked', kind: 'hermes', config: {}, order: 0 },
  { id: 'l-hermes-done', columnId: 'c-hermes-done', name: 'Done', kind: 'hermes', config: {}, order: 0 }
];
let cards: Card[] = [
  { id: 'card-1', laneId: 'l-hermes', title: 'Test Card', body: 'This is a test card.', order: 0, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-w1', laneId: 'l-welders-backlog', title: 'Meyer Werft GmbH', body: 'Location: Papenburg, DE\nIndustry: Shipbuilding\nContact: bewerbung@meyerwerft.de\n\nSuggested Template: Direct Placement Offer (German)', order: 0, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-w2', laneId: 'l-welders-backlog', title: 'Damen Shipyards Group', body: 'Location: Gorinchem, NL\nIndustry: Maritime / Shipbuilding\nContact: careers@damen.com\n\nSuggested Template: Direct Placement Offer (English)', order: 1, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-w3', laneId: 'l-welders-backlog', title: 'Siemens Energy', body: 'Location: Mülheim, DE\nIndustry: Energy Infrastructure\nContact: hr.energy@siemens.com\n\nSuggested Template: Direct Placement Offer (German)', order: 2, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-s1', laneId: 'l-sales-backlog', title: 'RecruitTech Agency', body: 'Profile: 5-person technical staffing firm\nContact: LinkedIn outreach\n\nSuggested Template: The "Scale Your Agency" Pitch', order: 0, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-s2', laneId: 'l-sales-backlog', title: 'BuildCo HR Dept', body: 'Profile: Construction HR Manager\nContact: hr@buildco.de\n\nSuggested Template: The "In-House Speed" Pitch', order: 1, state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-h1', laneId: 'l-hermes-backlog', title: 'Refactor UI Components', body: 'Upgrade all old generic buttons to the new glassmorphic spec. Apply hover states and subtle glow borders.', order: 0, agent: 'Hermes', model: 'auto', state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-h2', laneId: 'l-hermes-inprogress-jarvis', title: 'Analyze Dependency Graph', body: 'Run a full static analysis on the frontend components to find circular dependencies across Jarvis and Hermes scopes.', order: 0, agent: 'Jarvis', model: 'auto', state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-h3', laneId: 'l-hermes-review', title: 'Review PR #4052', body: 'Welders team submitted a PR for the new automated deployment script.', order: 0, agent: 'Welders', model: 'auto', state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-h4', laneId: 'l-hermes-blocked', title: 'Deploy Voice Pipeline', body: 'Voice TTS server is returning a 502 Bad Gateway. Check deployment logs.', order: 0, agent: 'Jarvis', model: 'auto', state: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'card-h5', laneId: 'l-hermes-done', title: 'Initialize Workspace Routing', body: 'Ensure /hermes properly mounts the Kanban board without legacy modules.', order: 0, agent: 'Hermes', model: 'auto', state: 'done', createdAt: Date.now(), updatedAt: Date.now() }
];
let runs: Run[] = [];

export const localDataPort: DataPort = {
  async listBoards() {
    return boards;
  },
  
  async createBoard(input: { name: string; description?: string }) {
    const board: Board = {
      id: generateId(),
      name: input.name,
      description: input.description,
      createdAt: Date.now(),
    };
    boards.push(board);
    return board;
  },

  async listColumns(boardId: Id) {
    return columns.filter(c => c.boardId === boardId).sort((a, b) => a.order - b.order);
  },

  async createColumn(input: { boardId: Id; name: string; order: number }) {
    const column: Column = {
      id: generateId(),
      boardId: input.boardId,
      name: input.name,
      order: input.order,
    };
    columns.push(column);
    return column;
  },

  async listLanes(columnId: Id) {
    return lanes.filter(l => l.columnId === columnId).sort((a, b) => a.order - b.order);
  },

  async createLane(input: NewLane) {
    const lane: Lane = {
      id: generateId(),
      columnId: input.columnId,
      name: input.name,
      kind: input.kind,
      config: input.config,
      order: input.order,
    };
    lanes.push(lane);
    return lane;
  },

  async updateLaneConfig(laneId: Id, config: unknown) {
    const lane = lanes.find(l => l.id === laneId);
    if (lane) {
      lane.config = { ...(lane.config as any || {}), ...(config as any || {}) };
    }
  },

  async listCards(laneId: Id) {
    return cards.filter(c => c.laneId === laneId).sort((a, b) => a.order - b.order);
  },

  async createCard(input: NewCard) {
    const card: Card = {
      id: generateId(),
      laneId: input.laneId,
      title: input.title,
      body: input.body,
      order: input.order,
      agent: input.agent,
      model: input.model,
      state: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    cards.push(card);
    return card;
  },

  async moveCard(input: { cardId: Id; toLaneId: Id; toOrder: number }) {
    const card = cards.find(c => c.id === input.cardId);
    if (!card) throw new Error("Card not found");
    
    // Shift other cards in the target lane
    const targetLaneCards = cards.filter(c => c.laneId === input.toLaneId && c.id !== input.cardId);
    for (const c of targetLaneCards) {
      if (c.order >= input.toOrder) {
        c.order += 1;
        c.updatedAt = Date.now();
      }
    }
    
    card.laneId = input.toLaneId;
    card.order = input.toOrder;
    card.updatedAt = Date.now();
  },

  async setCardState(cardId: Id, state: CardState) {
    const card = cards.find(c => c.id === cardId);
    if (card) {
      card.state = state;
      card.updatedAt = Date.now();
    }
  },

  async setCardRun(cardId: Id, runId: Id | null) {
    const card = cards.find(c => c.id === cardId);
    if (card) {
      card.currentRunId = runId || undefined;
      card.updatedAt = Date.now();
    }
  },

  async createRun(input: NewRun) {
    const run: Run = {
      id: generateId(),
      cardId: input.cardId,
      laneId: input.laneId,
      workerKind: input.workerKind,
      input: input.input,
      status: 'queued',
      startedAt: Date.now(),
    };
    runs.push(run);
    return run;
  },

  async updateRun(runId: Id, patch: Partial<Run>) {
    const runIndex = runs.findIndex(r => r.id === runId);
    if (runIndex !== -1) {
      runs[runIndex] = { ...runs[runIndex], ...patch };
      
      // Trigger watchers
      const watchers = runWatchers.get(runId) || [];
      watchers.forEach(cb => cb(runs[runIndex]));
    }
  },

  async listRunsByCard(cardId: Id) {
    return runs.filter(r => r.cardId === cardId).sort((a, b) => b.startedAt - a.startedAt);
  },

  watchRun(runId: Id, cb: (run: Run) => void) {
    if (!runWatchers.has(runId)) {
      runWatchers.set(runId, new Set());
    }
    runWatchers.get(runId)!.add(cb);
    
    // Initial call
    const run = runs.find(r => r.id === runId);
    if (run) cb(run);
    
    return () => {
      runWatchers.get(runId)?.delete(cb);
    };
  }
};

export async function getRun(runId: Id) {
  return runs.find(r => r.id === runId);
}

const runWatchers = new Map<Id, Set<(run: Run) => void>>();
