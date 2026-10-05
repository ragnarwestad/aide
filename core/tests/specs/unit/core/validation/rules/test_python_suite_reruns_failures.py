"""`scripts/test-python`, the root's pytest suite in Aide's test command:
a failing test is run once more on its own, and only a second failure
counts."""

import os
import subprocess

import pytest


@pytest.fixture
def project(workspace_root, tmp_path):
    (tmp_path / ".venv").symlink_to(workspace_root / ".venv")
    (tmp_path / "pytest.ini").write_text("[pytest]\n")
    return tmp_path


def _run(workspace_root, project):
    return subprocess.run(
        [str(workspace_root / "scripts" / "test-python"), "-p", "no:xdist", "-p", "no:randomly"],
        cwd=project, capture_output=True, text=True, timeout=120,
        env={**os.environ, "PYTEST_ADDOPTS": "", "PY_COLORS": "0"},
    )


def test_a_test_that_fails_once_is_green_on_its_own(workspace_root, project):
    (project / "test_x.py").write_text(
        "import pathlib\n"
        "def test_ok():\n    pass\n"
        "def test_once():\n"
        "    seen = pathlib.Path(__file__).with_name('seen')\n"
        "    if not seen.exists():\n        seen.write_text('')\n        assert False\n"
    )
    r = _run(workspace_root, project)
    assert r.returncode == 0, r.stdout + r.stderr
    # The second run is the failing test alone, not the suite again.
    assert r.stdout.rstrip().splitlines()[-1].startswith("1 passed in")


def test_a_test_that_fails_twice_is_red(workspace_root, project):
    (project / "test_x.py").write_text("def test_always():\n    assert False\n")
    assert _run(workspace_root, project).returncode != 0
