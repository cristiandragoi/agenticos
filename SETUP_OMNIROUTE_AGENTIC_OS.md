# OmniRoute Setup & Integration for Agentic OS

This document details the configuration and architecture for integrating OmniRoute as the default AI gateway for Agentic OS.

## 1. Installation

OmniRoute was downloaded from GitHub and extracted to `C:\Users\Cris\OmniRoute`. 
Inside this folder, the dependencies were installed globally to expose the `omniroute` CLI.

```bash
cd C:\Users\Cris\OmniRoute
npm install
npm link
```

## 2. Running OmniRoute

To run OmniRoute, start the CLI daemon. By default, it will start a local gateway on port `20128`.

```bash
omniroute
```

Once running, the local OpenAI-compatible endpoint is available at:
`http://localhost:20128/v1`

## 3. Worker Reconfiguration

Agentic OS was originally configured to spawn Codex and Claude binaries directly using hardcoded models. This was refactored so that Agentic OS now spawns the `omniroute` CLI wrapper. The wrapper injects the appropriate proxy configurations and API base URLs dynamically into the upstream CLI tools before executing them.

### Codex (`server/src/workflows/workers/codex.ts`)
Changed the execution base from `codex` to `omniroute`, injecting the `launch-codex` command.
The `auto` profile routes coding requests through the OmniRoute `/v1` endpoint.

```typescript
const args = [
  "launch-codex",
  "--profile", "auto",
  "--",
  "exec", prompt,
  "--model", "auto",
  "--approval", config.approval,
  "--json"
];
```

### Claude Code (`server/src/workflows/workers/claude.ts`)
Changed the execution base from `claude` to `omniroute`, injecting the `launch` command.

```typescript
const args = [
  "launch",
  "--profile", "auto",
  "--",
  "-p", prompt,
  "--model", "auto",
  "--max-turns", config.maxTurns,
  "--output-format", "json"
];
```

## 4. Setting API Keys

To use real upstream providers (e.g. OpenAI, Anthropic, Qwen), ensure that your environment sets `OMNIROUTE_API_KEY`, or that you have configured your upstream keys through the OmniRoute dashboard.

If no keys are provided, OmniRoute will fall back to its internal `auto/free` routing endpoints if permitted.
