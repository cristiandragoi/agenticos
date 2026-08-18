import { logger } from '../utils/logger.js';
import { Router } from "express";
import { localDataPort } from "../adapters/localDataPort.js";
import { runtimeRegistry } from "../services/runtimeRegistry.js";
import { runStore } from "../services/runStore.js";
import { db } from "../services/db.js";

export const kanbanRouter = Router();

kanbanRouter.get("/boards", async (_req, res) => {
  res.json(await localDataPort.listBoards());
});
kanbanRouter.post("/boards", async (req, res) => {
  res.json(await localDataPort.createBoard(req.body));
});
kanbanRouter.get("/boards/:id/columns", async (req, res) => {
  res.json(await localDataPort.listColumns(req.params.id));
});
kanbanRouter.post("/columns", async (req, res) => {
  res.json(await localDataPort.createColumn(req.body));
});
kanbanRouter.get("/columns/:id/lanes", async (req, res) => {
  res.json(await localDataPort.listLanes(req.params.id));
});
kanbanRouter.post("/lanes", async (req, res) => {
  res.json(await localDataPort.createLane(req.body));
});
kanbanRouter.put("/lanes/:id/config", async (req, res) => {
  await localDataPort.updateLaneConfig(req.params.id, req.body);
  res.json({ ok: true });
});
kanbanRouter.get("/lanes/:id/cards", async (req, res) => {
  res.json(await localDataPort.listCards(req.params.id));
});
kanbanRouter.post("/cards", async (req, res) => {
  res.json(await localDataPort.createCard(req.body));
});
kanbanRouter.post("/cards/:id/move", async (req, res) => {
  await localDataPort.moveCard({
    cardId: req.params.id,
    toLaneId: req.body.toLaneId,
    toOrder: req.body.toOrder,
  });
  res.json({ ok: true });
});
kanbanRouter.get("/cards/:id/runs", async (req, res) => {
  res.json(await localDataPort.listRunsByCard(req.params.id));
});
kanbanRouter.get("/runs/:id", async (req, res) => {
  const { getRun } = await import("../adapters/localDataPort.js");
  res.json(await getRun(req.params.id));
});

/* ── POST /cards/:id/execute ──────────────────────────────────────── */
kanbanRouter.post("/cards/:id/execute", async (req, res) => {
  const cardId = req.params.id;
  const { prompt } = req.body;

  // Find the card across all boards → columns → lanes
  let foundCard: any = null;
  let foundLane: any = null;
  const boards = await localDataPort.listBoards();
  outer: for (const b of boards) {
    const cols = await localDataPort.listColumns(b.id);
    for (const col of cols) {
      const lanes = await localDataPort.listLanes(col.id);
      for (const lane of lanes) {
        const cards = await localDataPort.listCards(lane.id);
        const match = cards.find((c: any) => c.id === cardId);
        if (match) { foundCard = match; foundLane = lane; break outer; }
      }
    }
  }

  if (!foundCard) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Card not found" } });
    return;
  }

  const workerKind = foundLane.kind || "hermes";
  const cardPrompt = prompt || `${foundCard.title}\n\n${foundCard.body}`;

  // 1. Create kanban run
  const kanbanRun = await localDataPort.createRun({
    cardId, laneId: foundLane.id, workerKind, input: cardPrompt,
  });
  await localDataPort.setCardState(cardId, "running");
  await localDataPort.setCardRun(cardId, kanbanRun.id);

  // 2. Route through adapter (HermesAdapter → agentLoop → OmniRoute)
  const agentId = foundLane.config?.targetAgentId;
  if (agentId) {
    const agent = db.agents.get(agentId);
    const adapter = agent ? runtimeRegistry.getAdapter(agent.runtimeId) : undefined;
    if (adapter) {
      const globalRunId = `kanban-${kanbanRun.id}`;
      runStore.create({
        id: globalRunId, agentId, sessionId: `sess-${kanbanRun.id}`,
        workspaceId: "hermes-studio", mode: "task",
        status: "queued", input: cardPrompt,
        logs: [], events: [], linkedArtifacts: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });

      // Watch global run updates via EventEmitter and sync to kanban run
      const onUpdated = async (r: any) => {
        if (r.id !== globalRunId) return;
        const sMap: Record<string, string> = {
          queued: "queued", running: "running", completed: "succeeded", failed: "failed",
        };
        await localDataPort.updateRun(kanbanRun.id, {
          status: (sMap[r.status] || "queued") as any, output: r.output, error: r.errorMessage,
        });
        if (r.status === "completed" || r.status === "failed") {
          await localDataPort.setCardState(cardId, r.status === "completed" ? "done" : "error");
          await localDataPort.setCardRun(cardId, null);
          runStore.removeListener("run:updated", onUpdated);
        }
      };
      runStore.on("run:updated", onUpdated);

      adapter.invoke({
        runId: globalRunId, agentId, sessionId: `sess-${kanbanRun.id}`,
        workspaceId: "hermes-studio", mode: "task", prompt: cardPrompt,
      }).catch((err: any) => logger.error("[Kanban] Execute adapter error:", err.message));
    } else {
      simulateKanbanRun(kanbanRun.id, cardId);
    }
  } else {
    simulateKanbanRun(kanbanRun.id, cardId);
  }

  res.status(202).json({ runId: kanbanRun.id, cardId });
});

function simulateKanbanRun(runId: string, cardId: string): void {
  setTimeout(() => localDataPort.updateRun(runId, { status: "running" }), 300);
  setTimeout(async () => {
    await localDataPort.updateRun(runId, {
      status: "succeeded",
      output: `[Gateway: OmniRoute | launcher=kanban | profile=auto | port=20128]\nHermes card run OK — simulated execution completed.`,
    });
    await localDataPort.setCardState(cardId, "done");
    await localDataPort.setCardRun(cardId, null);
  }, 1800);
}
