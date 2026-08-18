export type Id = string;

export type CardState =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "error";

export type LaneKind = "claude" | "codex" | "hermes" | "http";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface Board {
  id: Id;
  name: string;
  description?: string;
  createdAt: number;
}

export interface Column {
  id: Id;
  boardId: Id;
  name: string;
  order: number;
}

export interface Lane {
  id: Id;
  columnId: Id;
  name: string;
  kind: LaneKind;
  config: unknown;
  order: number;
}

export interface Card {
  id: Id;
  laneId: Id;
  title: string;
  body: string;
  order: number;
  state: CardState;
  currentRunId?: Id;
  agent?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewLane {
  columnId: Id;
  name: string;
  kind: LaneKind;
  config: unknown;
  order: number;
}

export interface NewCard {
  laneId: Id;
  title: string;
  body: string;
  order: number;
  agent?: string;
  model?: string;
}

export interface NewRun {
  cardId: Id;
  laneId: Id;
  workerKind: string;
  input: unknown;
}

export interface Run {
  id: Id;
  cardId: Id;
  laneId: Id;
  status: RunStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  workerKind: string;
}

export interface DataPort {
  listBoards(): Promise<Board[]>;
  createBoard(input: { name: string; description?: string }): Promise<Board>;

  listColumns(boardId: Id): Promise<Column[]>;
  createColumn(input: {
    boardId: Id;
    name: string;
    order: number;
  }): Promise<Column>;

  listLanes(columnId: Id): Promise<Lane[]>;
  createLane(input: NewLane): Promise<Lane>;
  updateLaneConfig(laneId: Id, config: unknown): Promise<void>;

  listCards(laneId: Id): Promise<Card[]>;
  createCard(input: NewCard): Promise<Card>;
  moveCard(input: {
    cardId: Id;
    toLaneId: Id;
    toOrder: number;
  }): Promise<void>;
  setCardState(cardId: Id, state: CardState): Promise<void>;
  setCardRun(cardId: Id, runId: Id | null): Promise<void>;

  createRun(input: NewRun): Promise<Run>;
  updateRun(runId: Id, patch: Partial<Run>): Promise<void>;
  listRunsByCard(cardId: Id): Promise<Run[]>;
  watchRun(runId: Id, cb: (run: Run) => void): () => void;
}
