# Team Sheet: AgentTeams

**Objective**: Create the file status.txt with exactly this content: Agent Teams real runtime verified.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- Content of status.txt should be 'Agent Teams real runtime verified.'

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **Planner1** ➔ **Builder2**: `Planner1.plan.json` (Required)
- **Builder2** ➔ **Verifier3**: `status.txt` (Required)

## Agent Definitions

### Planner (Planner1)

- **Role**: Planner
- **Responsibilities**: create a plan for building and verifying the status.txt file

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `workspaceRoot`
- **Write Scopes**: `Planner1.plan.json`
- **Output Artifacts**: `Planner1.plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to build the status.txt file and verify its content.
```

### Builder (Builder2)

- **Role**: Builder
- **Responsibilities**: build the status.txt file according to the planner's plan
- **Dependencies**: Planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `workspaceRoot`, `Planner1.plan.json`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Build the status.txt file and then finish.
```

### Verifier (Verifier3)

- **Role**: Verifier
- **Responsibilities**: verify the content of the status.txt file
- **Dependencies**: Builder2, Planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `workspaceRoot`, `status.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Verify the content of status.txt and then finish.
```

