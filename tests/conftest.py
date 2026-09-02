"""Shared pytest fixtures for aide testing."""
import os as _os

# The whole suite runs under the machine's test lock (core/scripts/
# aide-record-test-run takes it around a project's test run, and a run
# already under it skips it). Said here so the many tests that call the
# script never queue behind the real gate running them — the lock tests
# themselves take this mark away again.
_os.environ.setdefault("AIDE_TEST_LOCK_HELD", "pytest")


def _parallel_pass(config):
    """True in the parallel pass of a `-n auto` run — on the controller
    and on every worker — and False in a plain `-n0` run and in the
    serial pass this file starts itself."""
    import os
    if os.environ.get("AIDE_SERIAL_PASS"):
        return False
    if os.environ.get("PYTEST_XDIST_WORKER"):
        return True
    return bool(config.getoption("numprocesses", default=None))


def pytest_collection_modifyitems(config, items):
    """The suite runs in parallel by default (pytest.ini: -n auto,
    --dist=loadgroup). Tests marked `serial` measure wall-clock time:
    they must never run concurrently with each other (one xdist_group),
    and they cannot share the host with nine busy workers either — a
    kill that must land inside a few seconds does not, under that load.
    So the parallel pass leaves them out, and `pytest_sessionfinish`
    below runs exactly those, alone, once every worker has drained —
    still inside the one `pytest` invocation the person ran."""
    import pytest as _pytest
    kept, deferred = [], []
    for item in items:
        if item.get_closest_marker("serial") is not None:
            item.add_marker(_pytest.mark.xdist_group("serial"))
            (deferred if _parallel_pass(config) else kept).append(item)
        else:
            kept.append(item)
    if deferred:
        config.hook.pytest_deselected(items=deferred)
        items[:] = kept


def pytest_sessionfinish(session, exitstatus):
    """After the parallel pass: the serial pass, in a child pytest with
    `-n0`, on the same paths and selection the person gave. Its result
    joins this run's exit status, so a red serial test is a red suite —
    never a silent skip."""
    import os
    import subprocess
    import sys
    config = session.config
    if not _parallel_pass(config) or os.environ.get("PYTEST_XDIST_WORKER"):
        return
    args = [a for a in config.invocation_params.args if not a.startswith("-n")]
    cmd = [sys.executable, "-m", "pytest", "-n0", "-p", "no:cacheprovider",
           "-m", "serial and not e2e and not evaluation", *args]
    print("\n--- serial pass: tests marked `serial`, alone, after the parallel pass ---", flush=True)
    rc = subprocess.call(cmd, cwd=str(config.invocation_params.dir),
                         env={**os.environ, "AIDE_SERIAL_PASS": "1"})
    if rc not in (0, 5) and session.exitstatus == 0:   # 5: no serial test selected
        session.exitstatus = rc

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
