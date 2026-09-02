"""Tests for core/scripts/aide-resolve-test-cmd (spec 361): the single
resolver both the archive gate and `/aide-implement` call to turn a
changeset's touched files into the test command(s) that cover them.

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
    git(project, "add", "-A")
    git(project, "commit", "-qm", "touch " + " ".join(rel_paths))


def run(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project)], capture_output=True, text=True,
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def test_no_scopes_configured_falls_back_to_the_plain_test_cmd(script, project):
    """REQ-6: a project with only the legacy `AIDE_TEST_CMD` resolves to
    that single command, unconditionally — never consults changed files
    or branch resolution at all."""
    write_config(project, "AIDE_TEST_CMD=echo legacy\n")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["commands"] == ["echo legacy"]


def test_no_config_at_all_resolves_to_an_empty_command_list(script, project):
    """No `.aide/config` at all is the same as no test command
    configured — an empty (never missing) `commands` array, `ok:true`."""
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["commands"] == []


def test_single_scope_match_resolves_to_that_scopes_command(script, project):
    write_config(
        project,
        "AIDE_TEST_SCOPE_PATHS_1=dashboard\n"
        "AIDE_TEST_SCOPE_CMD_1=echo dash\n",
    )
    branch_with_changed_files(project, "dashboard/x.txt")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo dash"]


def test_a_change_reaching_two_scopes_runs_the_union_of_both(script, project):
    """REQ-2: different files, each matching their own declared scope,
    is a union — every matched scope's command, in declaration order."""
    write_config(
        project,
        "AIDE_TEST_SCOPE_PATHS_1=core tests\n"
        "AIDE_TEST_SCOPE_CMD_1=echo root\n"
        "AIDE_TEST_SCOPE_PATHS_2=dashboard\n"
        "AIDE_TEST_SCOPE_CMD_2=echo dash\n",
    )
    branch_with_changed_files(project, "core/x.py", "dashboard/y.ts")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo root", "echo dash"]


def test_a_single_file_matching_two_overlapping_scopes_picks_the_first_declared(script, project):
    """REQ-2: one file matching more than one scope's OWN declared path
    (nested scope declarations) is a tie-break, not a union — the first
    declared scope wins, distinct from the two-file union case above."""
    write_config(
        project,
        "AIDE_TEST_SCOPE_PATHS_1=core\n"
        "AIDE_TEST_SCOPE_CMD_1=echo outer\n"
        "AIDE_TEST_SCOPE_PATHS_2=core/sub\n"
        "AIDE_TEST_SCOPE_CMD_2=echo inner\n",
    )
    branch_with_changed_files(project, "core/sub/x.py")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo outer"]


def test_a_file_matching_no_declared_scope_runs_every_scope(script, project):
    """REQ-3: doubt is resolved towards running everything, never towards
    an empty list."""
    write_config(
        project,
        "AIDE_TEST_SCOPE_PATHS_1=core\n"
        "AIDE_TEST_SCOPE_CMD_1=echo root\n"
        "AIDE_TEST_SCOPE_PATHS_2=dashboard\n"
        "AIDE_TEST_SCOPE_CMD_2=echo dash\n",
    )
    branch_with_changed_files(project, "README.md")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo root", "echo dash"]


def test_one_matched_file_and_one_unmatched_file_still_runs_every_scope(script, project):
    """The whole-changeset rule (not per file in isolation): a single
    unmatched file in an otherwise-matched changeset still tips the
    whole resolution to "run everything"."""
    write_config(
        project,
        "AIDE_TEST_SCOPE_PATHS_1=core\n"
        "AIDE_TEST_SCOPE_CMD_1=echo root\n"
        "AIDE_TEST_SCOPE_PATHS_2=dashboard\n"
        "AIDE_TEST_SCOPE_CMD_2=echo dash\n",
    )
    branch_with_changed_files(project, "core/x.py", "notes.txt")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo root", "echo dash"]


def test_scoped_keys_win_even_alongside_an_unused_legacy_cmd(script, project):
    """AC1: a coexisting (unused) `AIDE_TEST_CMD` line must not error or
    leak into the resolved commands once scopes are declared."""
    write_config(
        project,
        "AIDE_TEST_CMD=echo should-never-run\n"
        "AIDE_TEST_SCOPE_PATHS_1=dashboard\n"
        "AIDE_TEST_SCOPE_CMD_1=echo dash\n",
    )
    branch_with_changed_files(project, "dashboard/x.txt")
    rc, out, _ = run(script, project)
    assert rc == 0, out
    assert out["commands"] == ["echo dash"]
    assert "should-never-run" not in out["commands"]


def test_refuses_rather_than_silently_resolving_when_the_repo_is_broken(script, tmp_path):
    """Risk analysis: a diff/branch-resolution failure must be a REFUSAL
    (exitCode 2), never an empty, silently-"ok" command list — a broken
    worktree must not make the gate skip tests without saying so."""
    not_a_repo = tmp_path / "not-a-repo"
    not_a_repo.mkdir()
    proc = subprocess.run(
        [str(script), "--project-dir", str(not_a_repo)], capture_output=True, text=True,
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2, out
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


def test_refuses_without_project_dir(script):
    proc = subprocess.run([str(script)], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"
