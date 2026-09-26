import { dispatchHermes } from "./hermes.js";
import { logger } from "../../utils/logger.js";

export async function dispatchCodex({
  input,
  config,
}: {
  input: unknown;
  config: Record<string, unknown>;
}) {
  // CODEX_INVOCATION_DISABLED=true: Route engineering requests to Hermes
  logger.warn('[dispatchCodex] CODEX_INVOCATION_DISABLED=true. Redirecting worker execution directly to Hermes.');
  return await dispatchHermes({ input, config });
}
