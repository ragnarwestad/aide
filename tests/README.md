# Testing Guide for aide

## Table of contents

- [Overview](#overview)
- [Running tests](#running-tests)
    - [All tests](#all-tests)
    - [Specific test categories](#specific-test-categories)
    - [Specific test file](#specific-test-file)
- [Test structure](#test-structure)
- [Fixtures](#fixtures)
    - [`mock_workspace`](#mock_workspace)
    - [`mock_jira_response`](#mock_jira_response)
    - [`clean_env`](#clean_env)
    - [`workspace_root`](#workspace_root)
    - [`e2e_workspace`](#e2e_workspace)
- [Adding new tests](#adding-new-tests)
    - [1. Analyze existing code](#1-analyze-existing-code)
    - [2. Write a test that verifies behavior](#2-write-a-test-that-verifies-behavior)
    - [3. Run the test](#3-run-the-test)
    - [4. Verify coverage](#4-verify-coverage)
- [Best practices](#best-practices)
    - [Mock external dependencies](#mock-external-dependencies)
    - [Use temporary directories](#use-temporary-directories)
    - [Isolate environment variables](#isolate-environment-variables)
    - [Test both success and error cases](#test-both-success-and-error-cases)
- [Troubleshooting](#troubleshooting)
    - [Tests fail with "ModuleNotFoundError"](#tests-fail-with-modulenotfounderror)
    - [Coverage report is missing files](#coverage-report-is-missing-files)
    - [Tests hang (watch mode)](#tests-hang-watch-mode)
- [E2E Tests with CLI Headless Mode](#e2e-tests-with-cli-headless-mode)
    - [Running E2E tests](#running-e2e-tests)
    - [Headless mode per CLI](#headless-mode-per-cli)
    - [Verifying results](#verifying-results)
    - [Important notes about E2E tests](#important-notes-about-e2e-tests)
- [CI/CD](#cicd)
- [Goals](#goals)
- [Resources](#resources)

## Overview

This test suite verifies the functionality of the aide tool, including:

- Core scripts (`aide-generate-pdf`, `aide-generate-html`, `upgrade-ai-tools`)
- Implementation-specific commands (Claude Code, Codex, Copilot)
- The template system and placeholder replacement
- Environment variable handling
- Documentation structure and output validation

## Running tests

**First, activate the virtual environment:**

```bash
source .venv/bin/activate
```

You will then see `(venv)` in front of your prompt. Alternatively, you can run `.venv/bin/pytest` directly.

### All tests

```bash
# All tests
pytest

# With verbose output
pytest -v

# With coverage report
pytest --cov=. --cov-report=html
```

### Specific test categories

```bash
# Core script tests (aide-generate-pdf, aide-generate-html)
pytest tests/specs/unit/core -v

# Implementation-specific tests
pytest tests/specs/unit/implementations -v

# Claude Code tests only
pytest tests/specs/unit/implementations/claude-code -v

# Validation tests only
pytest tests/specs/unit/core/validation -v
```

### Pytest markers

**Note:** E2E and evaluation tests are **excluded from the standard `pytest` run** because they make real API calls that
cost money and take a long time.

```bash
# Standard run (excludes e2e and evaluation)
pytest

# Run E2E tests (requires CLI installed + authentication)
pytest -m e2e

# Run E2E for a specific implementation
pytest -m "e2e and claude_code"
pytest -m "e2e and copilot"
pytest -m "e2e and codex"

# Run evaluation tests (validates prompts via API)
pytest -m evaluation

# Run ALL tests (including e2e and evaluation)
pytest -m ""

# Other useful markers
pytest -m unit -v              # All unit tests
pytest -m integration -v       # Integration tests
pytest -m validation -v        # All validation tests
pytest -m claude_code -v       # Claude Code-specific
pytest -m codex -v             # Codex-specific
pytest -m copilot -v           # Copilot-specific
```

**Available markers** (defined in `pytest.ini`):

| Marker            | Description                                                    |
|-------------------|----------------------------------------------------------------|
| `unit`            | Unit tests (fast, no external dependencies)                    |
| `integration`     | Integration tests (require a full workspace)                   |
| `validation`      | Validation of output quality                                   |
| `e2e`             | End-to-end tests via CLI headless mode (slow, cost money)      |
| `evaluation`      | Evaluates prompts via AI API (slow, costs money)               |
| `claude_code`     | Claude Code-specific tests                                     |
| `codex`           | Codex-specific tests                                           |
| `copilot`         | Copilot-specific tests                                         |
| `implementations` | Cross-implementation parity tests                              |

### Specific test file

```bash
pytest tests/specs/unit/core/test_jira_opprett.py -v

# Single test
pytest tests/specs/unit/core/test_jira_opprett.py::TestFetchJiraData::test_fetch_jira_data_success -v
```

## Test structure

```text
tests/
├── specs/
│   ├── unit/                                 # Unit tests (fast, no API calls)
│   │   ├── core/                             # Core script tests
│   │   │   ├── validation/                   # Output validation
│   │   │   │   ├── test_documentation_structure.py
│   │   │   │   └── test_templates.py
│   │   │   ├── test_jira_opprett.py
│   │   │   └── test_todo_opprett.py
│   │   │
│   │   └── implementations/                  # Implementation-specific tests
│   │       ├── claude-code/
│   │       ├── codex/
│   │       └── copilot/
│   │
│   ├── integration/                          # Integration tests
│   │   └── claude_code/                      # Claude Code integration
│   │
│   ├── e2e/                                  # End-to-end tests (excluded from the standard run)
│   │   ├── test_claude_e2e.py                # Claude Code: Tests slash commands (/aide-create, /aide-analyze)
│   │   ├── test_codex_e2e.py                 # Codex: Tests prompts via `codex exec --full-auto`
│   │   └── test_copilot_e2e.py               # Copilot: Tests prompts from implementations/copilot/prompts/
│   │
│   └── evaluation/                           # Prompt evaluation via API (excluded)
│
├── utils/                                    # Shared test utilities
│   └── shared_assertions.py
│
└── conftest.py                               # Pytest fixtures
```

## Fixtures

### `mock_workspace`

Creates a complete mock workspace structure with templates.

```python
def test_something(mock_workspace):
    # mock_workspace is a tmp_path with the full structure
    assert (mock_workspace / "core" / "templates").exists()
```

### `mock_jira_response`

Mock JIRA API response data.

```python
def test_jira_parsing(mock_jira_response):
    # mock_jira_response contains typical JIRA JSON
    assert mock_jira_response["key"] == "PROJ-TEST-001"
```

### `clean_env`

Cleans environment variables before the test (isolation).

```python
def test_env_vars(clean_env, monkeypatch):
    # The environment is clean, so you can set your own values
    monkeypatch.setenv("AIDE_INSTALLATION_PATH", "/test/path")
```

### `workspace_root`

Returns the actual workspace root path.

```python
def test_real_workspace(workspace_root):
    # workspace_root points to the actual aide/
    assert (workspace_root / "core" / "scripts").exists()
```

### `e2e_workspace`

Creates an isolated workspace for E2E tests with the required structure.

```python
@pytest.mark.e2e
def test_aide_workflow(e2e_workspace, workspace_root):
    # e2e_workspace is a tmp_path with core/ and specs/ structure
    # Environment variables are automatically set to e2e_workspace
    specs_path = e2e_workspace / "specs"
    assert specs_path.exists()
```

## Adding new tests

### 1. Analyze existing code

Before writing tests, understand how the code actually works:

```bash
# Read the script
cat core/scripts/aide-generate-pdf

# Test manually (see the script's own usage info)
./core/scripts/aide-generate-pdf
```

### 2. Write a test that verifies behavior

```python
import pytest


@pytest.mark.unit
def test_my_function(mock_workspace):
    """Test that my_function does what it should."""
    # Arrange
    expected_result = "something"

    # Act
    result = my_function()

    # Assert
    assert result == expected_result
```

### 3. Run the test

```bash
pytest tests/unit/test_my_module.py -v
```

### 4. Verify coverage

```bash
pytest tests/unit/test_my_module.py --cov=core.scripts.my_module --cov-report=term
```

## Best practices

### Mock external dependencies

```python
from unittest.mock import Mock, patch


@patch('subprocess.run')
def test_with_subprocess_mock(mock_run):
    mock_run.return_value = Mock(returncode=0, stdout="success")
    # Test code that calls subprocess.run
```

### Use temporary directories

```python
def test_file_operations(tmp_path):
    # tmp_path is a temporary directory that is deleted after the test
    test_file = tmp_path / "test.txt"
    test_file.write_text("content")
    assert test_file.read_text() == "content"
```

### Isolate environment variables

```python
def test_env_handling(monkeypatch):
    monkeypatch.setenv("MY_VAR", "test_value")
    # Test code that uses MY_VAR
    # The environment is restored after the test
```

### Test both success and error cases

```python
def test_success_case():
    result = my_function(valid_input)
    assert result is not None


def test_error_case():
    with pytest.raises(ValueError):
        my_function(invalid_input)
```

## Troubleshooting

### Tests fail with "ModuleNotFoundError"

Run pytest from the workspace root:

```bash
cd /path/to/aide
pytest
```

### Coverage report is missing files

Check `pytest.ini` - the cov paths must match the actual structure:

```ini
[pytest]
addopts =
    --cov=core
```

### Tests hang (watch mode)

Always use pytest without watch mode in CI/CD:

```bash
pytest  # NOT pytest-watch
```

## E2E Tests with CLI Headless Mode

All AI CLI tools support a headless mode that makes it possible to run real end-to-end tests.

**Note:** E2E tests are excluded from the standard `pytest` run. See [Pytest markers](#pytest-markers).

### Running E2E tests

```bash
# All E2E tests
pytest -m e2e

# Per implementation
pytest -m "e2e and claude_code"
pytest -m "e2e and copilot"
pytest -m "e2e and codex"
```

### Headless mode per CLI

| CLI         | Headless flag      | Status     | Example                                                 |
|-------------|--------------------|------------|---------------------------------------------------------|
| Claude Code | `-p`               | ✅ Works    | `claude -p "prompt" --allowedTools "Bash,Read,Write"`   |
| Copilot     | `-p`               | ✅ Works    | `copilot -p "prompt" --allow-all-tools`                 |
| Codex       | `exec --full-auto` | ✅ Works    | `codex exec --full-auto --skip-git-repo-check "prompt"` |

### Claude Code

```bash
# Headless mode
claude -p "prompt" --allowedTools "Bash,Read,Write"

# With JSON output
claude -p "prompt" --output-format json
claude -p "prompt" --output-format stream-json
```

### GitHub Copilot CLI

```bash
# Headless mode
copilot -p "prompt"

# With tool permissions
copilot -p "prompt" --allow-tool "shell(bash)"
copilot -p "prompt" --allow-all-tools
```

### OpenAI Codex CLI

```bash
# Exec mode (headless) - requires --full-auto for automatic execution
codex exec --full-auto --skip-git-repo-check "prompt"

# With output to a file
codex exec --full-auto -o result.txt "prompt"

# With JSON output (for parsing)
codex exec --full-auto --json "prompt"
```

### Example E2E test

```python
@pytest.mark.e2e
@pytest.mark.claude_code
def test_claude_headless_basic():
    """Test basic Claude headless mode execution."""
    result = subprocess.run(
        ["claude", "-p", "Say 'hello' and nothing else",
         "--output-format", "json"],
        capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0
    assert len(result.stdout) > 0
```

### Verifying results

In headless mode you can verify results in several ways:

**1. Exit code**

```bash
claude -p "Create file" && echo "Success" || echo "Failed"
```

**2. JSON output parsing**

```bash
result=$(claude -p "Say hello" --output-format json)
echo "$result" | jq '.result'
```

**3. Checking side effects (files created)**

```python
# Run the command
subprocess.run(["claude", "-p", "/aide-create TODO test Description"])

# Verify that the files were created
assert (specs_dir / "todo-01-test" / "1-description.md").exists()
```

**4. Complete example with all verifications**

```python
@pytest.mark.e2e
def test_aide_workflow_creates_files(tmp_path, monkeypatch):
    """Verify that the workflow creates the expected files."""
    monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(tmp_path))
    (tmp_path / "specs" / "todo").mkdir(parents=True)

    # Run the command
    result = subprocess.run(
        ["claude", "-p", "/aide-create TODO test-task Description",
         "--output-format", "json"],
        capture_output=True, text=True, timeout=120,
        cwd=str(tmp_path)
    )

    # 1. Verify exit code
    assert result.returncode == 0, f"Failed: {result.stderr}"

    # 2. Verify output (not empty)
    assert len(result.stdout) > 0, "No output"

    # 3. Verify side effects (files created)
    todo_dirs = list((tmp_path / "specs" / "todo").glob("TODO-*"))
    assert len(todo_dirs) >= 1, "No TODO directory created"

    expected_files = ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]
    for filename in expected_files:
        assert (todo_dirs[0] / filename).exists(), f"Missing: {filename}"
```

### Important notes about E2E tests

- **Cost money** - they use real API calls
- **Slow** - can take 30-120 seconds per test
- **Require authentication** - the CLI must be installed and authenticated
- **Excluded from the standard run** - must be run explicitly with `-m e2e`

## CI/CD

**Note:** There is currently no CI/CD pipeline configured for this project.

To set up GitHub Actions, create `.github/workflows/test.yml`:

```yaml
# Example - not implemented yet
name: Tests
on: [ push, pull_request ]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pytest -v --cov=. --cov-report=xml
```

## Goals

- **Coverage:** Minimum 80% for Python scripts
- **Speed:** Unit tests < 1 second each
- **Isolation:** No test should depend on another
- **Repeatability:** Same result every time

## Resources

### Testing

- [Pytest Documentation](https://docs.pytest.org/)
- [Python unittest.mock](https://docs.python.org/3/library/unittest.mock.html)
- [Coverage.py](https://coverage.readthedocs.io/)

### Implementations

See the README for each implementation for CLI documentation and headless mode:

- [Claude Code](../implementations/claude-code/README.md)
- [GitHub Copilot CLI](../implementations/copilot/README.md)
- [OpenAI Codex CLI](../implementations/codex/README.md)
