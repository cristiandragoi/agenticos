# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create and verify the file 'status.txt' containing the content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The 'status.txt' file is created in the workspace root.
- The content of 'status.txt' is exactly: 'Agent Teams real runtime verified'.
- The Verifier Agent confirms that the file is correctly created and contains the specified content.

## Execution Sequence

1. **Planner Agent** (Planner)
2. **Builder Agent** (Builder)
3. **Verifier Agent** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `` (Required)
- **builder-1** ➔ **verifier-1**: `B:\AgenticOS\status.txt` (Required)

## Agent Definitions

### Planner Agent (planner-1)

- **Role**: Planner
- **Responsibilities**: Develop a plan to create and verify the 'status.txt' file

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `AgenticOS`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Understand the objective and develop a step-by-step plan to accomplish it.
```

### Builder Agent (builder-1)

- **Role**: Builder
- **Responsibilities**: Create and write the 'status.txt' file with the specified content

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: None
- **Write Scopes**: `AgenticOS/*`
- **Output Artifacts**: `AgenticOS/status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the handoff from the Planner and execute the plan to create and verify the 'status.txt' file.
```

### Verifier Agent (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify that the 'status.txt' file is created with the correct content
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
Read the handoff from both Planner and Builder, verify the contents of the 'status.txt' file.
```

