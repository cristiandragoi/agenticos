"use client";
import { useRun } from "../../lib/dataport";

export default function RunStream({ runId }: { runId: string }) {
  const run = useRun(runId);
  if (!run) return null;
  return (
    <pre
      style={{
        fontSize: 11,
        maxHeight: 120,
        overflow: "auto",
        background: "#0a0d12",
        padding: 4,
        borderRadius: 4,
        marginTop: 4,
      }}
    >
      {run.status}
      {"\n"}
      {run.error
        ? `error: ${run.error}`
        : run.output
        ? String(run.output).slice(0, 800)
        : ""}
    </pre>
  );
}
