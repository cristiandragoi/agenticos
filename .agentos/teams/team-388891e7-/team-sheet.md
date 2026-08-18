# Team Sheet: AgentTeams

**Objective**: Create the file 'status.txt' with exactly this content: 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The file 'status.txt' is created in the workspace root.
- The content of 'status.txt' is exactly: 'Agent Teams real runtime verified'.

## Execution Sequence

1. **Team Planner** (Planner)
2. **Team Builder** (Builder)
3. **Team Verifier** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `plan.json` (Required)
- **builder-1** ➔ **verifier-1**: `B:\AgenticOS\status.txt` (Required)

## Agent Definitions

### Team Planner (planner-1)

- **Role**: Planner
- **Responsibilities**: Formulate the plan

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `AgenticOS/**/*`
- **Write Scopes**: None
- **Output Artifacts**: `plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a detailed plan for creating 'status.txt' and hand it off to the Builder.
```

### Team Builder (builder-1)

- **Role**: Builder
- **Responsibilities**: Create 'status.txt' according to the plan
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `AgenticOS/plan.json`
- **Write Scopes**: `AgenticOS`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the handoff summary from the Planner and create the file as specified.
```

### Team Verifier (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the correctness of 'status.txt'
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the handoff summary from both Planner and Builder, then verify the content of 'status.txt'.
```

