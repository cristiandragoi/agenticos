---
description: Stabilize AgenticOS and build the core architecture in verified phases.
---

# AgenticOS Controlled Build

Execute the AgenticOS stabilization and core-development phases sequentially.

## Global constraints

- Work only in the active AgenticOS repository.
- Make the smallest possible change.
- Compile after every phase.
- Stop immediately if verification fails.
- Do not continue after a failed phase.
- Preserve the original provider error.

## Phase 0 — Stabilize CodeX

Goal:
Create `B:\AgenticOS\codex-test.txt` containing exactly:

`CODEX_WORKS`

Verification:
- backend compiles
- frontend compiles
- Tools run is greater than 0
- file exists
- CodeX status is completed

If verification fails, stop.

## Phase 1 — Workspace Core

Build:
- WorkspaceManager
- ProjectContext
- WorkspaceMemory

Verification:
- TypeScript compilation passes
- focused tests pass

If verification fails, stop.

## Phase 2 — Pipeline Registry

Build:
- PipelineDefinition
- PipelineRegistry
- TaskRouter

Verification:
- TypeScript compilation passes
- focused tests pass

If verification fails, stop.