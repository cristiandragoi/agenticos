# Team Sheet: Agent Teams Runtime Verification

**Objective**: Create and verify the file 'status.txt' with specific content.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- Content of 'status.txt' is exactly 'Agent Teams real runtime verified.'

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
- **Responsibilities**: Create the file 'status.txt' with specific content

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
DO NOT WRITE 'Task completed successfully.' Write EXACTLY 'Agent Teams real runtime verified.' into the file. DO NOT prefix the file path with 'workspaceRoot'. Just write to 'status.txt'.
```

### Builder (builder)

- **Role**: Builder
- **Responsibilities**: Write the specified content to 'status.txt'
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file, patch_file
- **Read Scopes**: None
- **Write Scopes**: `*.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
DO NOT WRITE 'Task completed successfully.' Write EXACTLY 'Agent Teams real runtime verified.' into the file. DO NOT prefix the file path with 'workspaceRoot'. Just write to 'status.txt'.
```

### Verifier (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the content of 'status.txt'
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `*.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use `readFile` on 'status.txt', DO NOT use shell commands like `echo` or `tee`.
```

