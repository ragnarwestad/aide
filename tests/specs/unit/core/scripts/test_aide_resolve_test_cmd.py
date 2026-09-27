"""Tests for core/scripts/aide-resolve-test-cmd: the one place a
project's test command is read, called by a step's own run, the landing
and `/aide-implement` alike.

No AI is involved anywhere in this file: the whole point of the script
is that the gate and a person's own run agree on "the tests" by
executing the literal same rule, not by two prose descriptions of it.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-resolve-test-cmd"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True,
    ).stdout.strip()


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(path), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
    (path / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    return path


@pytest.fixture
def project(tmp_path):
    return init_repo(tmp_path / "proj")


def write_config(project, text):
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "config").write_text(text)


def write_manifest(project, text):
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "project.yaml").write_text(text)


def branch_with_changed_files(project, *rel_paths):
    """Switch to a feature branch and commit one file per given
    repo-relative path, off the `main` branch `init_repo` already
    created — so `aide_test_scope_base_ref` (no origin configured in
    these fixtures) resolves to the local `main` branch, and the
    resolver's own `git diff main...HEAD` has real content to read."""
    git(project, "switch", "-q", "-c", "feature")
    for rel in rel_paths:
        p = project / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("change\n")
    # The named files and nothing else: `add -A` swept the fixture's own
    # `.aide/config` into the commit on any machine whose global ignore
    # does not drop it (CI), and a changed file no scope claims makes the
    # resolver run every scope — so the test read as a resolver bug.
    git(project, "add", "--", *rel_paths)
    git(project, "commit", "-qm", "touch " + " ".join(rel_paths))


def run(script, project, *extra):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project), *extra], capture_output=True, text=True,
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def resolve(script, project_dir, *extra):
    out = subprocess.run(
        [str(script), "--project-dir", str(project_dir), *extra], capture_output=True, text=True,
    )
    return out.returncode, json.loads(out.stdout.strip().splitlines()[-1])


def write_config(repo, text):
    (repo / ".aide").mkdir(exist_ok=True)
    (repo / ".aide" / "config").write_text(text)


def test_the_command_is_aide_test_cmd(script, project):
    write_config(project, "AIDE_TEST_CMD=make test\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": ["make test"]})


def test_no_aide_test_cmd_resolves_to_no_command(script, project):
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_the_manifest_is_not_read(script, project):
    (project / ".aide").mkdir()
    (project / ".aide" / "project.yaml").write_text("testCmd: echo manifest\nlandingTestCmd: echo e2e\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_other_test_keys_are_not_read(script, project):
    write_config(project, "AIDE_TEST_SCOPE_PATHS_1=core\nAIDE_TEST_SCOPE_CMD_1=pytest\nAIDE_LANDING_TEST_CMD=e2e\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_a_worktree_without_its_own_config_reads_the_main_checkout(script, project, tmp_path):
    write_config(project, "AIDE_TEST_CMD=make test\n")
    wt = tmp_path / "wt"
    git(project, "worktree", "add", "-q", "-b", "spec", str(wt))
    assert resolve(script, wt) == (0, {"ok": True, "commands": ["make test"]})


def test_a_worktree_with_its_own_config_reads_that(script, project, tmp_path):
    write_config(project, "AIDE_TEST_CMD=make test\n")
    wt = tmp_path / "wt"
    git(project, "worktree", "add", "-q", "-b", "spec", str(wt))
    write_config(wt, "AIDE_TEST_CMD=make wt-test\n")
    assert resolve(script, wt) == (0, {"ok": True, "commands": ["make wt-test"]})


def test_refuses_without_project_dir(script):
    code, answer = resolve(script, "")
    assert code == 2 and answer["ok"] is False


def test_refuses_an_unknown_argument(script, project):
    code, answer = resolve(script, project, "--landing")
    assert code == 2 and "unknown argument" in answer["error"]
