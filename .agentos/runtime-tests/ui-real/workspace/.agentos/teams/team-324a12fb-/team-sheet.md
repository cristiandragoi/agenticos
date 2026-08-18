# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create the file status.txt with exactly the content: Agent Teams real runtime verified.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file 'status.txt' contains exactly the content: Agent Teams real runtime verified.
- The Builder did not write 'Task completed successfully.' in the file.

## Execution Sequence

1. **PlannerAgent** (Planner)
2. **BuilderAgent** (Builder)
3. **VerifierAgent** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `status.txt` (Required)

## Agent Definitions

### PlannerAgent (planner)

- **Role**: Planner
- **Responsibilities**: Create the file status.txt with specific content

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.txt`
- **Write Scopes**: None
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the `finish` tool to handoff the exact instructions to the Builder.
```

### BuilderAgent (builder)

- **Role**: Builder
- **Responsibilities**: Write the specified content to status.txt
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: None
- **Write Scopes**: `**/status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
DO NOT write 'Task completed successfully.' Write exactly 'Agent Teams real runtime verified.' into the file. DO NOT prefix the file path with 'workspaceRoot'. Just write to 'status.txt'.
```

### VerifierAgent (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the content of status.txt
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: None
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use `readFile` on 'status.txt', DO NOT use shell commands like `echo` or `tee`.
```

