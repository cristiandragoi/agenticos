# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create the file status.txt with the exact content 'Agent Teams real runtime verified.' and verify its contents.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file 'status.txt' is created with the exact content 'Agent Teams real runtime verified.'

## Execution Sequence

1. **Planner1** (Planner)
2. **Builder1** (Builder)
3. **Verifier1** (Verifier)

## Handoffs

- **planner1** ➔ **builder1**: `` (Required)
- **builder1** ➔ **verifier1**: `` (Required)

## Agent Definitions

### Planner1 (planner1)

- **Role**: Planner
- **Responsibilities**: Create a plan to achieve the objective

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to create the file 'status.txt' with the exact content 'Agent Teams real runtime verified.' and handoff to the Builder.
```

### Builder1 (builder1)

- **Role**: Builder
- **Responsibilities**: Create the file with the exact content and verify it
- **Dependencies**: planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
DO NOT write 'Task completed successfully.' Write EXACTLY 'Agent Teams real runtime verified.' into the file. DO NOT prefix the file path with 'workspaceRoot'. Just write to 'status.txt'. Do not use shell commands like `echo` or `tee`.
```

### Verifier1 (verifier1)

- **Role**: Verifier
- **Responsibilities**: Verify the contents of the file
- **Dependencies**: planner1, builder1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use `readFile` on 'status.txt', DO NOT use shell commands like `echo` or `tee`.
```

