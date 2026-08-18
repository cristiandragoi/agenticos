# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create and verify the file 'status.txt' with the specified content.
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The file 'status.txt' should be created with the content 'Agent Teams real runtime verified'. The Verifier Agent should confirm that the content is correct.

## Execution Sequence

1. **Planner Agent** (Planner)
2. **Builder Agent** (Builder)
3. **Verifier Agent** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `planner-1.plan` (Required)
- **builder-1** ➔ **verifier-1**: `builder-1.output` (Required)

## Agent Definitions

### Planner Agent (planner-1)

- **Role**: Planner
- **Responsibilities**: Plan the overall task

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `glob patterns`
- **Write Scopes**: `planner-1.plan`
- **Output Artifacts**: `planner-1.plan`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to create and verify the file 'status.txt' with the content 'Agent Teams real runtime verified'. Ensure that all steps are detailed and executable.
```

### Builder Agent (builder-1)

- **Role**: Builder
- **Responsibilities**: Execute the plan and create the file
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: None
- **Write Scopes**: `**/*.txt`
- **Output Artifacts**: `builder-1.output`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the provided plan to execute the tasks. Ensure that the file 'status.txt' is created with the correct content.
```

### Verifier Agent (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the file content
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: None
- **Write Scopes**: None
- **Output Artifacts**: `verifier-1.output`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check if the file 'status.txt' has been created with the correct content. Use any necessary tools to validate the contents.
```

