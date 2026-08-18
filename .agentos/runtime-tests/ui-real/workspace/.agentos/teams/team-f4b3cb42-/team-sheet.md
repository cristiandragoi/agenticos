# Team Sheet: AgentTeamsRealRuntimeVerification

**Objective**: Create and verify the file 'status.txt' with specific content.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file 'status.txt' contains exactly the text 'Agent Teams real runtime verified.' with no additional text.

## Execution Sequence

1. **Agent Planner** (Planner)
2. **Agent Builder** (Builder)
3. **Agent Verifier** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `planner_plan.json` (Required)
- **builder** ➔ **verifier**: `status.txt` (Required)

## Agent Definitions

### Agent Planner (planner)

- **Role**: Planner
- **Responsibilities**: Develop the initial plan

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: None
- **Output Artifacts**: `planner_plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Ensure that the Builder writes 'Agent Teams real runtime verified.' to status.txt and not any additional text.
```

### Agent Builder (builder)

- **Role**: Builder
- **Responsibilities**: Create the required file with specific content
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, write_file
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Write 'Agent Teams real runtime verified.' to status.txt and not any additional text.
```

### Agent Verifier (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the correctness of the file
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
Ensure that status.txt contains 'Agent Teams real runtime verified.' only.
```

