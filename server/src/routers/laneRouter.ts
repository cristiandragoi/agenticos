import { logger } from '../utils/logger.js';
import { Router } from "express";
import { localDataPort } from "../adapters/localDataPort.js";
import { getLane } from "../core/lanes/index.js";
import type { LaneKind } from "../core/dataport/index.js";
import { runPipeline } from "../core/runs/pipeline.js";
import { dispatchClaude } from "../workflows/workers/claude.js";
import { dispatchCodex } from "../workflows/workers/codex.js";
import { dispatchHermes } from "../workflows/workers/hermes.js";
import { dispatchHttp } from "../workflows/workers/generic-http.js";

type DispatchBody = {
  cardId: string;
  laneId: string;
  laneKind: LaneKind;
  laneConfig: Record<string, unknown>;
  cardTitle: string;
  cardBody: string;
};

type Dispatcher = (args: {
  input: unknown;
  config: Record<string, unknown>;
}) => Promise<unknown>;

const dispatchers: Record<LaneKind, Dispatcher> = {
  claude: dispatchClaude,
  codex: dispatchCodex,
  hermes: dispatchHermes,
  http: dispatchHttp,
};

export const laneRouter = Router();

laneRouter.post("/dispatch", async (req, res) => {
  try {
    const body = req.body as DispatchBody;
    const lane = getLane(body.laneKind);
    const dispatcher = dispatchers[body.laneKind];
    
    if (!dispatcher) {
      res.status(400).json({ error: `unknown lane kind: ${body.laneKind}` });
      return;
    }

    const input = lane.buildInput({
      title: body.cardTitle,
      body: body.cardBody,
    });

    // Fire-and-forget; pipeline updates the run state as it goes.
    runPipeline({
      port: localDataPort,
      cardId: body.cardId,
      laneId: body.laneId,
      workerKind: body.laneKind,
      input,
      run: () => dispatcher({ input, config: body.laneConfig }),
    }).catch((err) => {
      logger.error("pipeline failed", err);
    });

    res.status(202).json({ ok: true });
  } catch (error) {
    logger.error("Error dispatching card", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
