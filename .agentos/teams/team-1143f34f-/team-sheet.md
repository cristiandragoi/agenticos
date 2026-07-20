# Team Sheet: AgentTeam

**Objective**: Create a file named 'status.txt' with the content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The file 'status.txt' is created in the workspace root.
- The content of 'status.txt' matches exactly: 'Agent Teams real runtime verified'

## Execution Sequence

1. **Planner Agent** (Planner)
2. **Builder Agent** (Builder)
3. **Verifier Agent** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `plan.txt` (Required)
- **builder-1** ➔ **verifier-1**: `status.txt` (Required)

## Agent Definitions

### Planner Agent (planner-1)

- **Role**: Planner
- **Responsibilities**: Create a plan to achieve the objective

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Analyze the objective and create a detailed plan, including steps for each agent's responsibilities.
```

### Builder Agent (builder-1)

- **Role**: Builder
- **Responsibilities**: Create the file 'status.txt' with the specified content
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `**/*`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Follow the plan to create the required file. Ensure the content is exactly as specified.
```

### Verifier Agent (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the file 'status.txt' has been created correctly
- **Dependencies**: builder-1, planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check the content of 'status.txt' to ensure it matches the required text.
```

