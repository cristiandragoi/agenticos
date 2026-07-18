import { spawn } from "node:child_process";

export function runProcess(
  cmd: string,
  args: string[],
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))
    );
  });
}

export async function dispatchClaude({
  input,
  config,
}: {
  input: unknown;
  config: Record<string, unknown>;
}) {
  const prompt = (input as { prompt?: string }).prompt ?? "";
  const args = [
    "launch",
    "--profile",
    "auto",
    "--",
    "-p",
    prompt,
    "--model",
    "auto",
    "--max-turns",
    String(config.maxTurns ?? 8),
    "--output-format",
    "json",
  ];
  const cwd = String(config.workdir ?? ".");
  return await runProcess("omniroute", args, cwd);
}
