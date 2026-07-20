# Team Sheet: Status Verification Team

**Objective**: Create a 'status.txt' file with the content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS\.agentos\runtime-tests\ui-real\workspace`

## Acceptance Criteria

- The 'status.txt' file exists in the workspace root directory.
- The 'status.txt' file contains the exact content 'Agent Teams real runtime verified'.

## Execution Sequence

1. **Team Planner** (Planner)
2. **File Builder** (Builder)
3. **File Verifier** (Verifier)

## Handoffs

- **planner-1** ➔ **builder-1**: `plan.json` (Required)
- **builder-1** ➔ **verifier-1**: `workspaceRoot/status.txt` (Required)

## Agent Definitions

### Team Planner (planner-1)

- **Role**: Planner
- **Responsibilities**: Develop a plan to create the 'status.txt' file

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `workspaceRoot/**/*`
- **Write Scopes**: `plan.json`
- **Output Artifacts**: `plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Create a plan that outlines the steps required to create the 'status.txt' file with the specified content.
```

### File Builder (builder-1)

- **Role**: Builder
- **Responsibilities**: Create the 'status.txt' file with the specified content
- **Dependencies**: planner-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `plan.json`, `workspaceRoot/**/*`
- **Write Scopes**: `workspaceRoot/status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Read the plan from the Planner, and use it to create the 'status.txt' file in the correct location.
```

### File Verifier (verifier-1)

- **Role**: Verifier
- **Responsibilities**: Verify the 'status.txt' file was created correctly
- **Dependencies**: planner-1, builder-1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `workspaceRoot/**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check that the 'status.txt' file has been created with the correct content and location.
```

