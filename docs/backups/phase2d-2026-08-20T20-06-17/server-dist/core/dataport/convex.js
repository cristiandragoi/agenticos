// Lazy require so the import doesn't break in environments where
// `convex/_generated/api` hasn't been generated yet (e.g. before `convex dev`).
function loadApi() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../../../../convex/_generated/api");
    return mod.api;
}
export function convexDataPort(opts = {}) {
    const api = opts.api ?? loadApi();
    return {
        async listBoards() {
            const rows = await api.query(api.kanban.listBoards, {});
            return rows.map((r) => ({
                id: r._id,
                name: r.name,
                description: r.description,
                createdAt: r.createdAt,
            }));
        },
        async createBoard(input) {
            const id = await api.mutation(api.kanban.createBoard, input);
            return {
                id,
                name: input.name,
                description: input.description,
                createdAt: Date.now(),
            };
        },
        async listColumns(boardId) {
            const rows = await api.query(api.kanban.listColumns, { boardId });
            return rows.map((r) => ({
                id: r._id,
                boardId: r.boardId,
                name: r.name,
                order: r.order,
            }));
        },
        async createColumn(input) {
            const id = await api.mutation(api.kanban.createColumn, input);
            return { id, ...input };
        },
        async listLanes(columnId) {
            const rows = await api.query(api.kanban.listLanes, { columnId });
            return rows.map((r) => ({
                id: r._id,
                columnId: r.columnId,
                name: r.name,
                kind: r.kind,
                config: r.config,
                order: r.order,
            }));
        },
        async createLane(input) {
            const id = await api.mutation(api.kanban.createLane, input);
            return { id, ...input };
        },
        async listCards(laneId) {
            const rows = await api.query(api.kanban.listCards, { laneId });
            return rows.map((r) => ({
                id: r._id,
                laneId: r.laneId,
                title: r.title,
                body: r.body,
                order: r.order,
                state: r.state,
                currentRunId: r.currentRunId,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            }));
        },
        async createCard(input) {
            const id = await api.mutation(api.kanban.createCard, input);
            return {
                id,
                laneId: input.laneId,
                title: input.title,
                body: input.body,
                order: input.order,
                state: "idle",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
        },
        async moveCard(input) {
            await api.mutation(api.kanban.moveCard, input);
        },
        async setCardState(cardId, state) {
            await api.mutation(api.kanban.setCardState, { cardId, state });
        },
        async setCardRun(cardId, runId) {
            await api.mutation(api.kanban.setCardRun, { cardId, runId });
        },
        async createRun(input) {
            const id = await api.mutation(api.runs.createRun, input);
            return {
                id,
                ...input,
                status: "queued",
                startedAt: Date.now(),
            };
        },
        async updateRun(runId, patch) {
            await api.mutation(api.runs.updateRun, { runId, patch });
        },
        async listRunsByCard(cardId) {
            const rows = await api.query(api.runs.listRunsByCard, { cardId });
            return rows.map((r) => ({
                id: r._id,
                cardId: r.cardId,
                laneId: r.laneId,
                status: r.status,
                input: r.input,
                output: r.output,
                error: r.error,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
                workerKind: r.workerKind,
            }));
        },
        watchRun(runId, cb) {
            let stopped = false;
            const tick = async () => {
                while (!stopped) {
                    const row = await api.query(api.runs.getRun, { runId });
                    if (!row)
                        return;
                    const run = {
                        id: row._id,
                        cardId: row.cardId,
                        laneId: row.laneId,
                        status: row.status,
                        input: row.input,
                        output: row.output,
                        error: row.error,
                        startedAt: row.startedAt,
                        finishedAt: row.finishedAt,
                        workerKind: row.workerKind,
                    };
                    cb(run);
                    if (run.status === "succeeded" ||
                        run.status === "failed" ||
                        run.status === "cancelled") {
                        return;
                    }
                    await new Promise((r) => setTimeout(r, 500));
                }
            };
            tick();
            return () => {
                stopped = true;
            };
        },
    };
}
