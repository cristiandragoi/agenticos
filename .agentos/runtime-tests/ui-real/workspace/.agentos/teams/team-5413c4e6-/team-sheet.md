# Team Sheet: AgenticOS Agent Teams Real Runtime

**Objective**: Create the file status.txt with content 'Agent Teams real runtime verified.' and handoff to Builder.
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- status.txt file exists with the content 'Agent Teams real runtime verified.'

## Execution Sequence

1. **Planner Agent** (Planner)
2. **Builder Agent** (Builder)
3. **Verifier Agent** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `planner-plan.json` (Required)

## Agent Definitions

### Planner Agent (planner-1)

- **Role**: Planner
- **Responsibilities**: Create plan for creating status.txt

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.txt`, `*.md`
- **Write Scopes**: None
- **Output Artifacts**: `planner-plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the 'read_file' and 'search_files' tools to gather necessary information. Do not attempt to write files.
```

### Builder Agent (builder-1)

- **Role**: Builder
- **Responsibilities**: Create status.txt based on the plan
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: None
- **Write Scopes**: `status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the 'read_file', 'search_files', and 'write_file' tools. Ensure you have write permissions for the output directory.
```

### Verifier Agent (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the creation of status.txt
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: None
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the 'read_file' and 'terminal' tools. Do not attempt to modify source code.
```

