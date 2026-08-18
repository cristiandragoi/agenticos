# Team Sheet: Runtime Verification Team

**Objective**: Create and verify the 'status.txt' file.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The 'status.txt' file is created with the content 'Agent Teams real runtime verified'
- The Verifier confirms the correctness of 'status.txt'

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `plan.txt` (Required)
- **builder-1** ➔ **verifier-1**: `status.txt` (Required)

## Agent Definitions

### Planner (planner-1)

- **Role**: Planner
- **Responsibilities**: Plan the creation and verification of status.txt

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*`
- **Write Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to create 'status.txt' with the specified content and verify it.
```

### Builder (builder-1)

- **Role**: Builder
- **Responsibilities**: Create and verify the 'status.txt' file
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `*`
- **Write Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the plan provided by Planner to create and verify the 'status.txt' file.
```

### Verifier (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the correctness of 'status.txt'
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check if the 'status.txt' file contains the correct content.
```

