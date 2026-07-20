# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create the file 'status.txt' with the exact content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- File 'status.txt' exists in the workspace.
- The content of 'status.txt' matches exactly with 'Agent Teams real runtime verified'.
- No other file named 'status.txt' exists in the workspace.

## Execution Sequence

1. **Planner 1** (Planner)
2. **Builder 1** (Builder)
3. **Verifier 1** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `B:\AgenticOS\planner-1-plan.json` (Required)
- **builder-1** ➔ **verifier-1**: `B:\AgenticOS\status.txt` (Required)

## Agent Definitions

### Planner 1 (planner-1)

- **Role**: Planner
- **Responsibilities**: Develop a plan to create 'status.txt' with the specified content

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/status.txt`
- **Write Scopes**: None
- **Output Artifacts**: `AgenticOS/planner-1-plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use available tools to search for any existing file named 'status.txt' and ensure it is deleted or replaced if necessary. Then, develop a plan to create the file with the exact content provided.
```

### Builder 1 (builder-1)

- **Role**: Builder
- **Responsibilities**: Create the file 'status.txt' with the specified content
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file
- **Read Scopes**: None
- **Write Scopes**: `**/status.txt`
- **Output Artifacts**: `AgenticOS/status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the handoff plan from Planner and use it to create the file 'status.txt'. Ensure the file is created in the correct location with the exact content provided.
```

### Verifier 1 (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the creation of 'status.txt' with the specified content
- **Dependencies**: builder-1, planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: None
- **Write Scopes**: None
- **Output Artifacts**: `AgenticOS/verification-result.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the file 'status.txt' and verify that it contains the exact content provided. Ensure no other files named 'status.txt' exist in the workspace.
```

