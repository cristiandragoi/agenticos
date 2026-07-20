# Team Sheet: AgentTeams

**Objective**: Create and verify the file 'status.txt' with the specified content.
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The 'status.txt' file exists in the workspace root.
- The content of the 'status.txt' file is: Agent Teams real runtime verified

## Execution Sequence

1. **Planner1** (Planner)
2. **Builder1** (Builder)
3. **Verifier1** (Verifier)

## Handoffs

- **planner1** ➔ **builder1**: `B:\AgenticOS\planner1_plan.txt` (Required)
- **builder1** ➔ **verifier1**: `B:\AgenticOS\status.txt` (Required)

## Agent Definitions

### Planner1 (planner1)

- **Role**: Planner
- **Responsibilities**: Create a plan for the task

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: None
- **Output Artifacts**: `AgenticOS/planner1_plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a detailed plan on how to achieve the objective, and ensure that all necessary steps are included.
```

### Builder1 (builder1)

- **Role**: Builder
- **Responsibilities**: Create the 'status.txt' file
- **Dependencies**: planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file
- **Read Scopes**: `AgenticOS/planner1_plan.txt`
- **Write Scopes**: `AgenticOS/status.txt`
- **Output Artifacts**: `AgenticOS/status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the plan provided by Planner1 to create the 'status.txt' file with the specified content.
```

### Verifier1 (verifier1)

- **Role**: Verifier
- **Responsibilities**: Verify the 'status.txt' file
- **Dependencies**: planner1, builder1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/*.*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check that the 'status.txt' file was created correctly and contains the specified content.
```

