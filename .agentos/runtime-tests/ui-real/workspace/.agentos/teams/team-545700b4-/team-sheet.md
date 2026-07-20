# Team Sheet: Agent Teams

**Objective**: Create the file status.txt with exactly this content: Agent Teams real runtime verified.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file 'status.txt' exists in the workspace with the exact content: Agent Teams real runtime verified.

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `` (Required)
- **builder** ➔ **verifier**: `status.txt` (Required)

## Agent Definitions

### Planner (planner)

- **Role**: Planner
- **Responsibilities**: Define the plan

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Create a plan to accomplish the user's goal using the available tools and follow the instructions for Builders and Verifiers.
```

### Builder (builder)

- **Role**: Builder
- **Responsibilities**: Execute the plan and write to the file
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `**/*`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
DO NOT write 'Task completed successfully.' Write EXACTLY 'Agent Teams real runtime verified.' into the file. DO NOT prefix the file path with 'workspaceRoot'. Just write to 'status.txt'.
```

### Verifier (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the completion of tasks
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use `readFile` on 'status.txt', DO NOT use shell commands like `echo` or `tee`.
```

