# Team Sheet: AgentTeamsRealRuntimeVerified

**Objective**: Create the file status.txt with exactly this content: Agent Teams real runtime verified.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The file status.txt exists.
- The content of status.txt is 'Agent Teams real runtime verified.'

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `planner-1.plan.json` (Required)
- **builder-1** ➔ **verifier-1**: `status.txt` (Required)

## Agent Definitions

### Planner (planner-1)

- **Role**: Planner
- **Responsibilities**: Design the multi-agent team and plan the steps to achieve the objective

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.json`, `*.txt`
- **Write Scopes**: `planner-1.plan.json`
- **Output Artifacts**: `planner-1.plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Follow the user request and create a valid JSON for the multi-agent system.
```

### Builder (builder-1)

- **Role**: Builder
- **Responsibilities**: Write the content to status.txt and signal completion
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `planner-1.plan.json`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the writeFile tool to write 'Agent Teams real runtime verified.' to the path 'status.txt', then use the finish tool.
```

### Verifier (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the content of status.txt
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `status.txt`, `planner-1.plan.json`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the readFile tool on 'status.txt' to check the content, then use the finish tool.
```

