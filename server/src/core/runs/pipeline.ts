import type { DataPort, Id } from "../dataport/index.js";

export interface PipelineOpts {
  port: DataPort;
  cardId: Id;
  laneId: Id;
  workerKind: string;
  input: unknown;
  run: () => Promise<unknown>;
}

export async function runPipeline(opts: PipelineOpts): Promise<Id> {
  const { port, cardId, laneId, workerKind, input } = opts;
  const run = await port.createRun({ cardId, laneId, workerKind, input });
  await port.setCardRun(cardId, run.id);
  await port.setCardState(cardId, "running");
  await port.updateRun(run.id, { status: "running" });

  try {
    const output = await opts.run();
    await port.updateRun(run.id, {
      status: "succeeded",
      output,
      finishedAt: Date.now(),
    });
  } catch (err) {
    await port.updateRun(run.id, {
      status: "failed",
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      finishedAt: Date.now(),
    });
    throw err;
  }

  return run.id;
}
