"""Tests for core/scripts/hooks/commit-msg-spec-guard — the best-effort
git hook that rejects a hand-written spec commit (spec 219).

An incident on 2026-08-24: spec 218 was hand-copied from spec 217's
already-correct pattern instead of running /aide-create again. Nothing
stopped the commit — the convention that names which commit did what
(`Run /aide-<step> for <folder>`, documented in
core/rules/spec-structure.md's "Workflow steps completed" section) was
enforced only by asking, in the skills that offer it. This hook is the
git-level half: it inspects staged spec files and rejects a commit
whose message does not match the convention.

Real git repos via subprocess, mirroring test_aide_pull_specs.py — not
mocked, since the whole point is the interaction between git's own
staged-file view and HEAD.
"""
import re
import subprocess

import pytest


@pytest.fixture
def hook(workspace_root):
    return workspace_root / "core" / "scripts" / "hooks" / "commit-msg-spec-guard"


def git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=check,
    ).stdout.strip()


def init_repo(path, hook):
    """A git repo with an initial commit and the hook installed directly
    into .git/hooks — this file tests the hook's own logic, not the
    installer (see test_aide_install_spec_hook.py for that)."""
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    (path / "README.md").write_text("start\n")
    git(path, "add", "README.md")
    git(path, "commit", "-qm", "init")
    hooks_dir = path / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    target = hooks_dir / "commit-msg"
    target.write_text(hook.read_text())
    target.chmod(0o755)
    return path


def commit(repo, message):
    return subprocess.run(
        ["git", "-C", str(repo), "commit", "-qm", message],
        capture_output=True, text=True,
    )


def write_spec_file(repo, relpath, content="content\n"):
    path = repo / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    git(repo, "add", relpath)


class TestNewSpecFilesRequireTheConvention:
    """AC1-2: a new 2-analysis.md (or 3-solution.md/4-status.md/
    0-README.md/1-description.md) needs a conforming message."""

    def test_a_non_conforming_message_is_rejected(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/2-analysis.md")

        result = commit(repo, "Add analysis for spec 55")

        assert result.returncode != 0
        assert "commit-msg-spec-guard" in result.stderr

    def test_a_conforming_message_is_accepted(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/2-analysis.md")

        result = commit(repo, "Run /aide-analyze for 55-example")

        assert result.returncode == 0, result.stderr
        assert git(repo, "log", "-1", "--format=%s") == "Run /aide-analyze for 55-example"

    def test_a_headless_suffix_is_accepted(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/3-solution.md")

        result = commit(repo, "Run /aide-analyze for 55-example (headless)")

        assert result.returncode == 0, result.stderr

    def test_a_stopped_suffix_is_accepted(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/4-status.md")

        result = commit(repo, "Run /aide-implement for 55-example (stopped: time limit)")

        assert result.returncode == 0, result.stderr

    def test_a_new_readme_is_gated(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/0-README.md")

        result = commit(repo, "Add a new spec")

        assert result.returncode != 0

    def test_a_new_description_is_gated(self, hook, tmp_path):
        """The shape of the actual 2026-08-24 incident: a brand-new
        1-description.md, hand-copied from a previous spec."""
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/1-description.md")

        result = commit(repo, "Add spec 55")

        assert result.returncode != 0


class TestModifyingAnExistingDescriptionIsAllowed:
    """AC3: spec-structure.md's one documented outside-the-flow
    allowance — a hand-edit to an EXISTING 1-description.md's
    Description field."""

    def test_a_modify_only_description_change_needs_no_convention(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/1-description.md", "one\n")
        commit(repo, "Run /aide-create for 55-example")

        write_spec_file(repo, "55-example/1-description.md", "one\ntwo\n")
        result = commit(repo, "Clarify the description")

        assert result.returncode == 0, result.stderr


class TestModifyingOtherExistingSpecFilesIsGated:
    """AC4: unlike 1-description.md, a content-only hand-edit to an
    already-existing 2-analysis.md/3-solution.md/4-status.md/
    0-README.md is gated exactly like a new file — no documented case
    allows hand-editing their content outside a skill run."""

    @pytest.mark.parametrize("relpath", [
        "55-example/2-analysis.md",
        "55-example/3-solution.md",
        "55-example/4-status.md",
        "55-example/0-README.md",
    ])
    def test_a_modify_only_change_is_still_rejected(self, hook, tmp_path, relpath):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, relpath, "one\n")
        commit(repo, "Run /aide-analyze for 55-example")

        write_spec_file(repo, relpath, "one\ntwo\n")
        result = commit(repo, "Copy from another spec")

        assert result.returncode != 0

    @pytest.mark.parametrize("relpath", [
        "55-example/2-analysis.md",
        "55-example/3-solution.md",
        "55-example/4-status.md",
    ])
    def test_a_modify_only_change_with_a_conforming_message_is_accepted(self, hook, tmp_path, relpath):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, relpath, "one\n")
        commit(repo, "Run /aide-analyze for 55-example")

        write_spec_file(repo, relpath, "one\ntwo\n")
        result = commit(repo, "Run /aide-implement for 55-example")

        assert result.returncode == 0, result.stderr


class TestUnrelatedCommitsAreUntouched:
    def test_a_commit_touching_no_spec_file_is_never_gated(self, hook, tmp_path):
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "notes.txt", "scratch\n")

        result = commit(repo, "Arbitrary message")

        assert result.returncode == 0, result.stderr

    def test_a_mixed_commit_with_no_gated_basename_passes_through(self, hook, tmp_path):
        """A file that merely lives beside a spec folder, but is not one
        of the five recognised basenames, is not the hook's business."""
        repo = init_repo(tmp_path / "specs", hook)
        write_spec_file(repo, "55-example/notes-scratch.md", "scratch\n")

        result = commit(repo, "Arbitrary message")

        assert result.returncode == 0, result.stderr


def test_the_shared_convention_regex_agrees_with_aide_run_spec(workspace_root, run_spec_source):
    """The Medium-risk mitigation named in 3-solution.md: the hook
    restates the convention regex independently in shell (spec-folder-
    agnostic, since the hook only knows which files are staged, not
    which spec they belong to). A fourth hand-paired duplicate after
    WORKFLOW_STEPS/DEPENDENCY_GATED_STEPS/errorReason — if
    aide-run-spec's copy (aide-run-spec:1623) ever grows a new suffix
    form, this is what notices the hook's copy did not follow.
    """
    bash = run_spec_source
    m = re.search(r'^\s*re="(\^Run /aide-.*)"$', bash, re.M)
    assert m, "aide-run-spec no longer declares its commit-subject regex the same way"
    run_spec_pattern = m.group(1).replace("${folder}", "55-example")

    hook_text = (workspace_root / "core" / "scripts" / "hooks" / "commit-msg-spec-guard").read_text()
    m = re.search(r'^\s*re="(\^Run /aide-.*)"$', hook_text, re.M)
    assert m, "commit-msg-spec-guard no longer declares its commit-subject regex the same way"
    hook_pattern = m.group(1)

    subjects_matching = [
        "Run /aide-create for 55-example",
        "Run /aide-analyze for 55-example (headless)",
        "Run /aide-implement for 55-example (stopped: time limit)",
        "Run /aide-archive for 55-example (headless) (stopped: budget)",
    ]
    subjects_not_matching = [
        "Add analysis for spec 55",
        "Copied from spec 217",
        "run /aide-create for 55-example",
        "Ran /aide-create for 55-example",
    ]

    for subject in subjects_matching:
        assert re.match(run_spec_pattern, subject), f"aide-run-spec's regex rejects: {subject}"
        assert re.match(hook_pattern, subject), f"the hook's regex rejects: {subject}"
    for subject in subjects_not_matching:
        assert not re.match(run_spec_pattern, subject), f"aide-run-spec's regex accepts: {subject}"
        assert not re.match(hook_pattern, subject), f"the hook's regex accepts: {subject}"
