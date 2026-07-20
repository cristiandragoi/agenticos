# Team Sheet: WeatherFetcher

**Objective**: Create a simple Python script to fetch the current weather for a city and save the output to a text file.
**Workspace Root**: `B:\AgenticOS\weather_fetcher`

## Acceptance Criteria

- The Python script should be able to fetch the current weather for a city and save the output to a text file.
- The script should run successfully without errors.

## Execution Sequence

1. **WeatherPlanner** (Planner)
2. **WeatherBuilder** (Builder)
3. **WeatherVerifier** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `plan.txt` (Required)
- **builder** ➔ **verifier**: `weather_fetcher.py` (Required)

## Agent Definitions

### WeatherPlanner (planner)

- **Role**: Planner
- **Responsibilities**: design plan for fetching weather and saving it

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `*.py`
- **Write Scopes**: None
- **Output Artifacts**: `plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Your task is to design a plan that outlines the steps required to create a Python script to fetch the current weather for a city and save the output to a text file.
```

### WeatherBuilder (builder)

- **Role**: Builder
- **Responsibilities**: implement the plan to create the Python script
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `plan.txt`
- **Write Scopes**: `*.py`
- **Output Artifacts**: `weather_fetcher.py`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Your task is to implement the plan designed by WeatherPlanner. Use the allowed tools to write the necessary Python code for fetching weather and saving it to a text file.
```

### WeatherVerifier (verifier)

- **Role**: Verifier
- **Responsibilities**: verify the correctness of the generated Python script
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `*.py`
- **Write Scopes**: None
- **Output Artifacts**: `test_results.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Your task is to verify that the Python script created by WeatherBuilder correctly fetches the current weather for a city and saves the output to a text file. Use allowed tools to test the script.
```

