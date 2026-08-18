# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create a file named 'status.txt' with the exact content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The 'status.txt' file must be created with the exact content 'Agent Teams real runtime verified'
- The Verifier Agent must confirm that the content is correct

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
- **Responsibilities**: design the team structure and tasks

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `AgenticOS`
- **Write Scopes**: None
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan that includes a Planner, at least one Builder, and exactly one Verifier.
```

### Builder Agent (builder-1)

- **Role**: Builder
- **Responsibilities**: create the 'status.txt' file with the specified content
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `AgenticOS`
- **Write Scopes**: `AgenticOS/*.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the provided plan to create the 'status.txt' file in the correct location.
```

### Verifier Agent (verifier-1)

- **Role**: Verifier
- **Responsibilities**: verify the content of the 'status.txt' file
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `AgenticOS/*.txt`
- **Write Scopes**: None
- **Output Artifacts**: `verification_result.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check if the 'status.txt' file contains the exact specified content.
```

