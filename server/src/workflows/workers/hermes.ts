import { runProcess } from "./claude.js";

export async function dispatchHermes({
  input,
  config,
}: {
  input: unknown;
  config: Record<string, unknown>;
}) {
  const prompt = (input as { prompt?: string }).prompt ?? "";
  // Route through OmniRoute gateway (same pipeline as Claude dispatcher)
  const args = [
    "launch",
    "--profile",
    String(config.profile ?? "auto"),
    "--",
    "-p",
    prompt,
    "--model",
    String(config.model ?? "qwythos:9b"),
    "--max-turns",
    String(config.maxTurns ?? 8),
    "--output-format",
    "json",
  ];
  const cwd = String(config.workdir ?? ".");
  return await runProcess("omniroute", args, cwd);
}
