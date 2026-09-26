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

# Every temp directory a test makes, and every one the scripts under test
# make (they inherit TMPDIR), goes inside this process's own, removed when
# the process exits. Left in the machine's shared temp directory they are
# never removed, and a directory of millions of entries takes minutes to
# read for every program that reaches for temp.
_own_tmp = _tempfile.mkdtemp(prefix="aide-pytest-")
_os.environ["TMPDIR"] = _own_tmp
_tempfile.tempdir = None
import atexit as _atexit
_atexit.register(shutil.rmtree, _own_tmp, True)


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
def run_spec_source(workspace_root):
    """`aide-run-spec` as one text: the script plus every part it sources,
    in the order it sources them.

    The runner was one 2925-line file until 2026-09-04, when its phases
    moved into `core/scripts/lib/run-spec-*.sh`. Every test that reads the
    runner's own source — a sentence it must carry, a regex two copies of
    which have to agree — reads it through here, so a part moving between
    files is not a test failure and a sentence disappearing still is.
    """
    scripts = workspace_root / "core" / "scripts"
    text = (scripts / "aide-run-spec").read_text()
    parts = []
    for line in text.splitlines():
        stripped = line.strip()
        prefix = 'source "$SCRIPT_DIR/lib/'
        if stripped.startswith(prefix) and stripped.endswith('"'):
            parts.append(stripped[len(prefix):-1])
    return "\n".join([text, *((scripts / "lib" / name).read_text() for name in parts)])


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

    # The specs root the tests configure; the skills come from what is
    # installed on the machine, as for a person's own run.
    (workspace / "specs").mkdir(parents=True)
    (workspace / "test-output").mkdir(parents=True)

    return workspace
