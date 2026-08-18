# Team Sheet: AgentTeamsRealRuntimeVerifiedTeam

**Objective**: Create the file status.txt with the content 'Agent Teams real runtime verified.'
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The status.txt file is created with the content 'Agent Teams real runtime verified.'
- The Builder does not write 'Task completed successfully.' into the file

## Execution Sequence

1. **Planner 1** (Planner)
2. **Builder 1** (Builder)
3. **Verifier 1** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `` (Optional)
- **builder-1** ➔ **verifier-1**: `status.txt` (Required)

## Agent Definitions

### Planner 1 (planner-1)

- **Role**: Planner
- **Responsibilities**: Develop the plan to create status.txt

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `workspaceRoot/**`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Focus solely on creating a plan. Do not attempt to write files or execute any actions outside of planning.
```

### Builder 1 (builder-1)

- **Role**: Builder
- **Responsibilities**: Create the status.txt file with the required content
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: None
- **Write Scopes**: `workspaceRoot/status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Do not write 'Task completed successfully.' Write EXACTLY 'Agent Teams real runtime verified.' into the file. Use the finish tool to handoff after completing the task.
```

### Verifier 1 (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the status.txt file is correctly created
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: None
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Do not modify source code. Ensure the status.txt file contains 'Agent Teams real runtime verified.'.
```

