# Team Sheet: Agent Teams Runtime Verification

**Objective**: Create the file status.txt with exactly this content: Agent Teams real runtime verified.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- Content of status.txt is 'Agent Teams real runtime verified.'

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner1** ➔ **builder1**: `planner1_plan.txt` (Required)

## Agent Definitions

### Planner (planner1)

- **Role**: Planner
- **Responsibilities**: Create a plan for building and verifying the status.txt file

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.txt`, `*.py`
- **Write Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace/planner1_plan.txt`
- **Output Artifacts**: `planner1_plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Handoff to builder after creating the plan.
```

### Builder (builder1)

- **Role**: Builder
- **Responsibilities**: Write the content to status.txt and finish the build process
- **Dependencies**: planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace/planner1_plan.txt`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use writeFile tool to write 'Agent Teams real runtime verified.' to the path 'status.txt', then use the finish tool.
```

### Verifier (verifier1)

- **Role**: Verifier
- **Responsibilities**: Verify the content of status.txt and finish the verification process
- **Dependencies**: planner1, builder1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/.agentos/runtime-tests/ui-real/workspace/status.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use readFile tool on 'status.txt' to check the content, then use the finish tool.
```

