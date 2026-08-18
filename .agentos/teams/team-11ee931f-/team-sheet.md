# Team Sheet: StatusUpdateTeam

**Objective**: Create a status.txt file with the specified content.
**Workspace Root**: `B:\AgenticOS`

## Acceptance Criteria

- The status.txt file must contain the exact content 'Agent Teams real runtime verified'. The content should not be altered or missing.
- All steps in the plan should have been executed sequentially without errors.

## Execution Sequence

1. **PlanAgent** (Planner)
2. **BuildAgent** (Builder)
3. **VerifyAgent** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `plan.txt` (Required)
- **builder** ➔ **verifier**: `status.txt` (Required)

## Agent Definitions

### PlanAgent (planner)

- **Role**: Planner
- **Responsibilities**: design the plan

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*.txt`
- **Write Scopes**: `plan.txt`
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Create a detailed plan for generating status.txt with the exact content 'Agent Teams real runtime verified'. Ensure all steps are executable and consider the dependencies between agents.
```

### BuildAgent (builder)

- **Role**: Builder
- **Responsibilities**: execute the plan
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `plan.txt`
- **Write Scopes**: `status.txt`
- **Output Artifacts**: `status.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Follow the plan created by PlanAgent to create status.txt with the exact content 'Agent Teams real runtime verified'. Ensure all steps are executed sequentially.
```

### VerifyAgent (verifier)

- **Role**: Verifier
- **Responsibilities**: verify the result
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
Check that status.txt has been created with the exact content 'Agent Teams real runtime verified'. If not, correct it.
```

