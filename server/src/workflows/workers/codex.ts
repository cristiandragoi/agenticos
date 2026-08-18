import { runProcess } from "./claude.js";

export async function dispatchCodex({
  input,
  config,
}: {
  input: unknown;
  config: Record<string, unknown>;
}) {
  const prompt = (input as { prompt?: string }).prompt ?? "";
  const args = [
    "launch-codex",
    "--profile",
    "auto",
    "--",
    "exec",
    prompt,
    "--model",
    "auto",
    "--approval",
    String(config.approval ?? "never"),
    "--json",
  ];
  const cwd = String(config.workdir ?? ".");
  return await runProcess("omniroute", args, cwd);
}
