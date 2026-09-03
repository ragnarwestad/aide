"""Shared pytest fixtures for aide testing."""
import os as _os


# The archive gate's own log (AIDE_TEST_GATE_LOG) defaults to the serving
# host's real ~/Library/Logs file; the gate tests here were writing their
# fixture runs ("81-x @ …") into it, which made the real log unreadable.
# Every test process inherits this one, under the system temp dir.
import tempfile as _tempfile
_os.environ.setdefault(
    "AIDE_TEST_GATE_LOG", _os.path.join(_tempfile.gettempdir(), "aide-test-gate-from-pytest.log")
)

import pytest
import sys
from pathlib import Path
import shutil
import os


@pytest.fixture
def mock_workspace(tmp_path):
    """Create a complete mock workspace structure."""
    workspace = tmp_path / "aide"
    workspace.mkdir()

    # Create directory structure
    (workspace / "core" / "templates" / "jira").mkdir(parents=True)
    (workspace / "core" / "templates" / "todo").mkdir(parents=True)
    (workspace / "core" / "scripts").mkdir(parents=True)
    (workspace / "specs" / "jira").mkdir(parents=True)
    (workspace / "specs" / "todo").mkdir(parents=True)

    # Copy templates from actual workspace
    # Use __file__ to find the actual workspace root (tests/conftest.py -> aide/)
    actual_workspace = Path(__file__).parent.parent

    # Copy JIRA templates if they exist
    jira_templates = actual_workspace / "core" / "templates" / "jira"
    if jira_templates.exists():
        for template_file in jira_templates.glob("*.template"):
            shutil.copy(template_file, workspace / "core" / "templates" / "jira")
    else:
        # Print warning if templates not found
        print(f"Warning: JIRA templates not found at {jira_templates}")

    # Copy TODO templates if they exist
    todo_templates = actual_workspace / "core" / "templates" / "todo"
    if todo_templates.exists():
        for template_file in todo_templates.glob("*.template"):
            shutil.copy(template_file, workspace / "core" / "templates" / "todo")
    else:
        # Print warning if templates not found
        print(f"Warning: TODO templates not found at {todo_templates}")

    return workspace


@pytest.fixture
def mock_jira_response():
    """Mock JIRA API response with typical structure."""
    return {
        "key": "PROJ-1234",
        "fields": {
            "summary": "Test JIRA Issue",
            "description": "This is a test description for testing purposes",
            "status": {"name": "Open"},
            "issuetype": {"name": "Story"},
            "priority": {"name": "Medium"},
            "reporter": {"displayName": "Test Reporter"},
            "assignee": {"displayName": "Test Assignee"},
            "created": "2025-11-01T10:00:00.000+0100",
            "updated": "2025-11-16T10:00:00.000+0100"
        }
    }


@pytest.fixture
def clean_env(monkeypatch):
    """Clean environment variables before each test."""
    # Store original values
    original_workspace = os.getenv("AIDE_INSTALLATION_PATH")

    # Delete env vars (the specs path is per-project .aide/config, no env)
    monkeypatch.delenv("AIDE_INSTALLATION_PATH", raising=False)

    yield

    # Restore original values if they existed
    if original_workspace:
        monkeypatch.setenv("AIDE_INSTALLATION_PATH", original_workspace)


@pytest.fixture
def workspace_root():
    """Return actual workspace root path.

    Always uses the actual test directory, not env vars.
    Env vars are for runtime, tests should use the source directory.
    """
    return Path(__file__).parent.parent


@pytest.fixture
def e2e_workspace(tmp_path, workspace_root):
    """Create a comprehensive workspace for E2E testing."""
    workspace = tmp_path / "e2e-workspace"
    workspace.mkdir()

    # Copy core directories
    for d in ["core/templates", "core/scripts", "core/docs"]:
        src = workspace_root / d
        if src.exists():
            shutil.copytree(src, workspace / d)

    # Create spec directories
    (workspace / "specs" / "todo").mkdir(parents=True)
    (workspace / "specs" / "jira").mkdir(parents=True)
    (workspace / "test-output").mkdir(parents=True)

    # Copy Claude Code commands (direct sources)
    claude_commands = workspace_root / "implementations" / "claude-code" / "commands"
    if claude_commands.exists():
        target_commands = workspace / ".claude" / "commands"
        target_commands.mkdir(parents=True)
        shutil.copytree(claude_commands, target_commands, dirs_exist_ok=True)

    return workspace
