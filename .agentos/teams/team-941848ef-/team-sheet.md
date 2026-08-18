# Team Sheet: AgentTeamsRuntimeVerification

**Objective**: Create the file 'status.txt' with the exact content: 'Agent Teams real runtime verified'
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The file 'status.txt' must exist in the workspace root with the exact content: 'Agent Teams real runtime verified'
- The verifier must confirm that the content is correct

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner1** ➔ **builder1**: `planner_plan.txt` (Required)
- **builder1** ➔ **verifier1**: `status.txt` (Required)

## Agent Definitions

### Planner (planner1)

- **Role**: Planner
- **Responsibilities**: Design plan for creating status.txt

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `glob patterns`
- **Write Scopes**: None
- **Output Artifacts**: `planner_plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Create a detailed step-by-step plan to accomplish the objective, focusing on verifying runtime.
```

### Builder (builder1)

- **Role**: Builder
- **Responsibilities**: Create status.txt according to the plan
- **Dependencies**: planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `glob patterns`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Follow the plan provided by Planner and create the file 'status.txt' with the exact content.
```

### Verifier (verifier1)

- **Role**: Verifier
- **Responsibilities**: Verify the correctness of status.txt
- **Dependencies**: builder1, planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `glob patterns`
- **Write Scopes**: None
- **Output Artifacts**: `verification_report.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check that 'status.txt' contains exactly the content: 'Agent Teams real runtime verified'. Use terminal for verification if necessary.
```

