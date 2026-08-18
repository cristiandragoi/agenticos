# Team Sheet: Agent Teams Real Runtime Verification

**Objective**: Create the file 'status.txt' with the content 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- File 'status.txt' exists in the workspace root
- Content of 'status.txt' is exactly 'Agent Teams real runtime verified'

## Execution Sequence

1. **Team Planner** (Planner)
2. **Team Builder** (Builder)
3. **Team Verifier** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `plan.json` (Required)
- **builder** ➔ **verifier**: `B:\AgenticOS\status.txt` (Required)

## Agent Definitions

### Team Planner (planner)

- **Role**: Planner
- **Responsibilities**: Plan the steps to create the file

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*`
- **Write Scopes**: None
- **Output Artifacts**: `plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to achieve the objective without writing any files directly.
```

### Team Builder (builder)

- **Role**: Builder
- **Responsibilities**: Create the file based on the plan
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `*`
- **Write Scopes**: `**/status.txt`
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the provided plan to create the file 'status.txt' with the specified content.
```

### Team Verifier (verifier)

- **Role**: Verifier
- **Responsibilities**: Verify the creation of the file
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check if the file 'status.txt' has been created correctly with the specified content.
```

