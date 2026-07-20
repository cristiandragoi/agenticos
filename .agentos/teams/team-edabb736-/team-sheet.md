# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create the file 'status.txt' with the content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The file 'status.txt' must exist in the workspace with the content 'Agent Teams real runtime verified'

## Execution Sequence

1. **Planner Agent** (Planner)
2. **Builder Agent** (Builder)
3. **Verifier Agent** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `plan.txt` (Required)
- **builder** ➔ **verifier**: `status.txt` (Required)

## Agent Definitions

### Planner Agent (planner)

- **Role**: Planner
- **Responsibilities**: Create a plan to create the file 'status.txt'

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: None
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Identify the necessary steps and tools required to achieve the objective.
```

### Builder Agent (builder)

- **Role**: Builder
- **Responsibilities**: Create the file 'status.txt' based on the plan
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Execute the steps outlined in the plan to create the required file.
```

### Verifier Agent (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the correctness of 'status.txt'
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check if the file contains the expected content.
```

