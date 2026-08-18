# Team Sheet: Multi-Agent Team

**Objective**: Create a file named 'status.txt' with specific content and ensure it passes verification.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file 'status.txt' contains the exact content: Agent Teams real runtime verified.

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
- **Responsibilities**: Create a handoff plan for the builder and verifier

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Hand off to the builder with the exact instructions: 'Create the file status.txt with exactly this content: Agent Teams real runtime verified.' Hand off to the verifier.
```

### Builder (builder)

- **Role**: Builder
- **Responsibilities**: Create the file with specified content and hand off to the verifier
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `*`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Hand off to the verifier once the file is created.
```

### Verifier (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the file content and ensure it passes the acceptance criteria
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `status.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Ensure the file content is 'Agent Teams real runtime verified.' If correct, mark as complete.
```

