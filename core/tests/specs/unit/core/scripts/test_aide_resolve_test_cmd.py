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

from .spec.spec_repos import git, project  # noqa: F401


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-resolve-test-cmd"


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


def test_the_files_command_is_read_with_the_test_command_ac_3(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\nAIDE_TEST_FILES_CMD: scripts/test-files\n")
    assert resolve(script, project) == (
        0, {"ok": True, "commands": ["make test"], "filesCommand": "scripts/test-files"})


def test_the_files_command_is_ignored_without_a_test_command_ac_3(script, project):
    write_manifest(project, "AIDE_TEST_FILES_CMD: scripts/test-files\n")
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_no_aide_test_cmd_resolves_to_no_command(script, project):
    assert resolve(script, project) == (0, {"ok": True, "commands": []})


def test_aide_config_and_the_old_keys_are_not_read(script, project):
    write_manifest(project, "testCmd: echo manifest\nlandingTestCmd: echo e2e\n")
    (project / ".aide" / "config").write_text("AIDE_TEST_CMD=make test\n")
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


def test_implement_uses_changed_command_only_when_requested(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\nAIDE_TEST_CHANGED_CMD: scripts/test-changed\n")
    git(project, "add", ".aide/project.yaml")
    git(project, "commit", "-qm", "settings")
    (project / "code.ts").write_text("changed")
    rc, result = resolve(script, project, "--changed-from", "main", "--targeted")
    assert rc == 0
    assert result["commands"] == ["scripts/test-changed 'main'"]
    assert result["targeted"] is True
    assert resolve(script, project)[1]["commands"] == ["make test"]


def test_targeted_without_project_command_keeps_full_suite(script, project):
    write_manifest(project, "AIDE_TEST_CMD: make test\n")
    assert resolve(script, project, "--changed-from", "main", "--targeted")[1]["commands"] == ["make test"]


def test_targeted_ref_is_shell_quoted_as_data(script, project):
    import shlex
    write_manifest(project, "AIDE_TEST_CMD: false\nAIDE_TEST_CHANGED_CMD: echo\n")
    ref = "feature's-branch"
    git(project, "branch", ref)
    rc, result = resolve(script, project, "--changed-from", ref, "--targeted")
    assert rc == 0
    assert shlex.split(result["commands"][0]) == ["echo", ref]
