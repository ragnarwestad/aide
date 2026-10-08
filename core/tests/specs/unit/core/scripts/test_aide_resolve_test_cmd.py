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


def resolve(script, project_dir, *extra):
    out = subprocess.run(
        [str(script), "--project-dir", str(project_dir), *extra], capture_output=True, text=True,
    )
    return out.returncode, json.loads(out.stdout.strip().splitlines()[-1])


def write_manifest(repo, text):
    (repo / ".aide").mkdir(exist_ok=True)
    (repo / ".aide" / "project.yaml").write_text(text)


def test_the_command_is_the_manifest_s_aide_test_cmd(script, project):
    write_manifest(project, "name: p\nAIDE_TEST_CMD: make test\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": ["make test"]})


def test_no_aide_test_cmd_resolves_to_no_command(script, project):
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_aide_config_and_the_old_keys_are_not_read(script, project):
    write_manifest(project, "testCmd: echo manifest\nlandingTestCmd: echo e2e\n")
    (project / ".aide" / "config").write_text("AIDE_TEST_CMD=make test\nAIDE_TEST_SCOPE_CMD_1=pytest\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_a_worktree_without_a_manifest_reads_the_main_checkout(script, project, tmp_path):
    wt = tmp_path / "wt"
    git(project, "worktree", "add", "-q", "-b", "spec", str(wt))
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    assert resolve(script, wt) == (0, {"ok": True, "commands": ["make test"]})


def test_a_worktree_with_its_own_manifest_reads_that(script, project, tmp_path):
    wt = tmp_path / "wt"
    git(project, "worktree", "add", "-q", "-b", "spec", str(wt))
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    write_manifest(wt, "AIDE_TEST_CMD: make wt-test\n")
    assert resolve(script, wt) == (0, {"ok": True, "commands": ["make wt-test"]})


def test_refuses_without_project_dir(script):
    code, answer = resolve(script, "")
    assert code == 2 and answer["ok"] is False


def test_refuses_an_unknown_argument(script, project):
    code, answer = resolve(script, project, "--landing")
    assert code == 2 and "unknown argument" in answer["error"]


def _docs_check(repo):
    (repo / "scripts").mkdir(exist_ok=True)
    (repo / "scripts" / "check-docs").write_text("#!/bin/sh\nexit 0\n")
    (repo / "scripts" / "check-docs").chmod(0o755)
    git(repo, "add", "scripts/check-docs")
    git(repo, "commit", "-qm", "docs check")


def test_a_markdown_only_change_runs_the_docs_check_instead(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    _docs_check(project)
    git(project, "switch", "-q", "-c", "spec")
    (project / "README.md").write_text("changed prose\n")
    git(project, "commit", "-qam", "Reword the readme")
    (project / "NOTES.md").write_text("new, not committed yet\n")
    assert resolve(script, project, "--changed-from", "main") == (
        0, {"ok": True, "commands": ["scripts/check-docs"], "docsOnly": True})


def test_a_markdown_only_change_with_no_docs_check_runs_nothing(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    git(project, "switch", "-q", "-c", "spec")
    (project / "README.md").write_text("changed prose\n")
    assert resolve(script, project, "--changed-from", "main") == (
        0, {"ok": True, "commands": [], "docsOnly": True})


def test_a_change_that_touches_anything_else_runs_the_test_command(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    _docs_check(project)
    git(project, "switch", "-q", "-c", "spec")
    (project / "README.md").write_text("changed prose\n")
    (project / "app.py").write_text("print(1)\n")
    assert resolve(script, project, "--changed-from", "main") == (0, {"ok": True, "commands": ["make test"]})


def test_no_change_at_all_runs_the_test_command(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    _docs_check(project)
    assert resolve(script, project, "--changed-from", "main") == (0, {"ok": True, "commands": ["make test"]})


def test_the_old_links_key_does_not_hide_a_change(script, project):
    """Only the manifest's worktreeLinks name the linked directories;
    `.aide/config`'s AIDE_WORKTREE_LINKS is never read, so a path under it
    is a change like any other."""
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    (project / ".aide" / "config").write_text("AIDE_WORKTREE_LINKS=vendor\n")
    _docs_check(project)
    git(project, "switch", "-q", "-c", "spec")
    (project / "README.md").write_text("changed prose\n")
    (project / "vendor").mkdir()
    (project / "vendor" / "lib.js").write_text("x\n")
    assert resolve(script, project, "--changed-from", "main") == (0, {"ok": True, "commands": ["make test"]})
