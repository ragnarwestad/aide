"""The conflict an archive is handed, the pre-check that skips the model
entirely, and the second tool: what Codex is told, what it records, and
what it refuses.

Split out of test_aide_run_spec_gates.py 2026-09-04; the tests are
unchanged and keep their names.
"""

import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import pytest
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import project_only_claude, writing_claude
from .run_spec_invoking import BRANCH, create, worktrees
from .run_spec_origins import is_ancestor
from .run_spec_results import CODEX_STREAM_FAILED, CODEX_STREAM_OK, CODEX_THREAD_ID, CODEX_USAGE, RESULT_ERROR, RESULT_OK, emits
from .run_spec_status_files import conflicting_branch, nested_workspace, status_only_conflict, with_status


def test_archive_is_handed_the_open_conflict_and_its_result_is_pushed(
    runner, workspace, fake_claude, origin
):
    """Criterion 1 (spec 171). Archive lands in a worktree that is
    mid-merge, with MERGE_HEAD set and the conflict markers still in the
    file — the resolution is archive's own first piece of work, and
    refusing before it starts is what every other step does instead."""
    project = workspace["project"]
    with_status(workspace, ["create", "analyze", "implement"])
    branch = conflicting_branch(workspace, published=True)
    claude = fake_claude(
        "cat > /dev/null\n"
        # Recorded DURING the run: the worktree is gone by the time the
        # test reads anything, and "was the conflict still open?" is the
        # one fact this step is about.
        f'git rev-parse -q --verify MERGE_HEAD >> {workspace["project"].parent / "merge-head.txt"} 2>/dev/null\n'
        f'grep -c "<<<<<<<" contested.txt >> {workspace["project"].parent / "markers.txt"} 2>/dev/null\n'
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        # And archive's own work, or the no-progress check (spec 268)
        # rightly says the folder was never moved.
        + READ_SPECS
        + 'mkdir -p "$specs/archive" && git -C "$specs" mv 81-queue-and-runner archive/81-queue-and-runner '
        + '&& git -C "$specs" commit -q -m "archive"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert rc == 0, out
    assert out["ok"] is True, out
    merge_head = (workspace["project"].parent / "merge-head.txt")
    assert merge_head.exists() and merge_head.read_text().strip(), \
        "the step must be started with the merge still open, not after an abort"
    markers = (workspace["project"].parent / "markers.txt").read_text().strip()
    assert markers != "0", "the conflict markers are the step's input"
    # The resolution reached origin, on the BRANCH.
    assert git(origin["project"], "branch", "--list", branch) != "", "the branch must be published"
    assert "resolved by the step" in git(project, "show", f"{branch}:contested.txt")
    assert is_ancestor(project, "main", branch), "main must now be contained in the branch"

def test_after_an_archive_resolution_the_default_branch_fast_forwards(
    runner, workspace, fake_claude, origin
):
    """Criterion 3 (spec 171). The point of pushing the branch is that
    the landing that follows finds a fast-forward — the same routine that
    refused before now succeeds, because the branch changed, not the
    routine."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert rc == 0, out
    ff = subprocess.run(
        ["git", "-C", str(project), "merge", "-q", "--ff-only", branch],
        capture_output=True, text=True,
    )
    assert ff.returncode == 0, ff.stderr

def test_an_archive_that_gives_up_leaves_the_branch_exactly_where_it_was(
    runner, workspace, fake_claude, origin
):
    """Criterion 4 (spec 171). Tests red, or a conflict the skill will
    not decide: the merge is undone, HEAD never moves, and the HEAD-moved
    push gate therefore publishes nothing. No new rollback machinery —
    the gate that already exists is the one that holds."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    before = git(project, "rev-parse", branch)
    claude = fake_claude(
        "cat > /dev/null\n"
        "git merge --abort\n"
        f"echo '{json.dumps(RESULT_ERROR)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert out["ok"] is False, out
    # It gave up, which is not the same as never having started: the
    # step must have been handed the conflict before it decided.
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "the branch must be left exactly as it was found"
    assert git(origin["project"], "branch", "--list", branch) == "", \
        "nothing may reach origin from a resolution that gave up"

def test_an_archive_that_walks_away_mid_merge_publishes_no_conflict_markers(
    runner, workspace, fake_claude, origin
):
    """Criterion 5 (spec 171). Archive can die between opening the
    conflict and deciding — a crash, a cancellation, a budget stop. The
    generic commit loop would otherwise `git add -A` the conflict markers
    and commit them as the merge, which is the half-merged tree the whole
    codebase refuses to leave anywhere."""
    project = workspace["project"]
    branch = conflicting_branch(workspace, published=True)
    before = git(project, "rev-parse", branch)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_ERROR)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive", push="branch")
    assert out["terminalReason"] != "refused", out
    assert fake_claude.calls.exists(), "the step must have been invoked at all"
    assert git(project, "rev-parse", branch) == before, "an undecided merge must not be committed"
    assert "<<<<<<<" not in git(project, "show", f"{branch}:contested.txt")
    assert git(origin["project"], "branch", "--list", branch) == ""

@pytest.mark.parametrize("step", ["create", "analyze", "implement"])
def test_every_other_step_still_refuses_a_conflict(runner, workspace, fake_claude, step):
    """Criterion 2 (spec 171). The fork is on the literal string
    `archive` and nothing else, so every step that refused yesterday
    refuses today — a step let past a conflict would commit the markers.
    All three are named, not the two that happened to be here before."""
    project = workspace["project"]
    conflicting_branch(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command=step)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "conflict" in out["error"]
    assert git(project, "status", "--porcelain") == ""

def test_a_4status_only_conflict_in_a_nested_specs_repo_resolves_to_mains_copy(
    runner, tmp_path, fake_claude
):
    """AC1. A conflict confined to the spec's own `4-status.md`, in a
    NESTED specs-repo layout, resolves mechanically before the AI-
    judgment routine ever sees it — main's corrected copy wins, no
    markers remain."""
    ws = nested_workspace(tmp_path)
    branch, status_rel = status_only_conflict(ws)
    claude = fake_claude("exit 1")  # would fail loudly if the merge ever reached it
    rc, out, _ = run(runner, ws, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert not fake_claude.calls.exists(), \
        "a mechanically-resolvable conflict must never reach the AI session"
    text = git(ws["specs"], "show", f"{branch}:{status_rel}")
    assert text == "main's corrected copy", text
    assert "<<<<<<<" not in text

def test_a_4status_conflict_with_another_file_also_conflicting_stays_open(
    runner, tmp_path, fake_claude
):
    """AC2. Something OTHER than the spec's own `4-status.md` also
    conflicts — today's open-conflict behavior is unchanged, and the
    step is still handed the live conflict to resolve itself."""
    ws = nested_workspace(tmp_path)
    branch, status_rel = status_only_conflict(ws, second_file="notes.txt")
    merge_head_file = ws["project"].parent / "merge-head.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'git -C "$specs" rev-parse -q --verify MERGE_HEAD >> {merge_head_file} 2>/dev/null\n'
        'printf "resolved by the step\\n" > "$specs/'
        f'{ws["folder"]}/4-status.md"\n'
        'git -C "$specs" add -A\n'
        'git -C "$specs" commit -q --no-edit\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="archive")
    assert rc == 0, out
    assert merge_head_file.exists() and merge_head_file.read_text().strip(), \
        "a conflict touching more than just 4-status.md must still be left open for the step"

def test_archive_behaves_like_any_other_step_when_there_is_nothing_to_resolve(
    runner, workspace, fake_claude
):
    """The fork must only bite on a real conflict. An `archive` run on a
    branch that merges cleanly is an ordinary step."""
    with_status(workspace, done=True)
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    git(project, "switch", "-q", "main")
    (project / "moved-on.txt").write_text("landed on main after the branch was made\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "later work on main")
    # In the project, because that is the branch the merge is asked
    # about: since spec 215 a branch this run never advanced past its
    # base is deleted at the end of it.
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert is_ancestor(project, "main", branch)

def test_archive_skips_the_model_when_the_spec_has_not_reached_implement(
    runner, workspace, fake_claude
):
    """Criterion 1. The fixture's default status file names `analyze` but
    not `implement` — "nothing started yet" from archive's own point of
    view — ordinary progression, never a warning, and costs nothing."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["exitCode"] == 0, out
    assert out["terminalReason"] == "not-implemented-yet", out
    assert not fake_claude.calls.exists(), "nothing to decide costs nothing"
    assert "costUsd" not in out or out.get("costUsd") == 0, out

def test_archive_skips_the_model_when_acceptance_criteria_are_unticked(
    runner, workspace, fake_claude
):
    """REQ-1: an unticked `## Acceptance criteria` row is a refusal a
    script already answers — costs nothing and never reaches claude."""
    with_status(workspace, done=True)
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.write_text(
        status_path.read_text()
        + "\n## Acceptance criteria\n\n"
        + "| Task | Status | Notes |\n|------|--------|-------|\n"
        + "| REQ-1: does the thing | ⬜ | |\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add acceptance criteria")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert not fake_claude.calls.exists(), "an unticked row costs nothing"

def test_archive_proceeds_past_an_in_progress_ordinary_row(
    runner, workspace, fake_claude
):
    """Spec 268 stopped gating archive on ordinary Phase/Checklist rows —
    only the `Workflow steps completed` line (has implement run at all)
    and, when present, the `## Acceptance criteria` section are read. A
    `🔄` row elsewhere is the implementer's own bookkeeping and no
    longer holds anything back: archive proceeds and spawns the model
    exactly as it would for a fully-ticked file."""
    body = (
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Workflow steps completed:** create, analyze, implement\n\n"
        "---\n\n## Phase 2: GREEN\n\n### Tasks\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| the Slack webhook | 🔄 | still wiring it up |\n"
    )
    (workspace["specs"] / workspace["folder"] / "4-status.md").write_text(body)
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "add status"], check=True)

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert fake_claude.calls.exists(), "an ordinary in-progress row must not skip the model"

def test_the_declined_result_carries_the_full_shape_a_completed_run_has(
    runner, workspace, fake_claude
):
    """Both skip-the-model outcomes must be indistinguishable, shape-
    wise, from any other step's successful JSON — a caller that only
    ever branches on `ok`/`ok`+`terminalReason` must not be surprised by
    a missing field."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, result_stdout = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    for field in ("ok", "exitCode", "terminalReason", "durationSec", "branch", "repos"):
        assert field in out, out
    assert out["durationSec"] == 0, out

def test_other_commands_still_spawn_the_model_with_no_status_file_at_all(
    runner, workspace, fake_claude
):
    """The new fast path is gated on the literal string `archive`, like
    every other archive-only fork in this script — a spec with no
    4-status.md is `analyze`'s normal starting point, not a reason to
    skip it (spec 344 gives `implement` a status-file precondition of its
    own; `analyze` keeps none)."""
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.unlink()
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "remove status"], check=True)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert fake_claude.calls.exists()

def test_resolve_is_no_longer_a_command_this_script_will_run(runner, workspace, fake_claude):
    """Criterion 8 (spec 171). The step is gone, not hidden: a caller
    that still asks for it — an old dashboard, a shell history entry, a
    queue-config left over from before — is refused by the same
    --command check every other unknown word meets, before any money is
    spent."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="resolve")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "Invalid --command" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_review_plan_is_refused_as_a_command(runner, workspace, fake_claude):
    """Criterion 1 (spec 181). `review-plan` folded into `analyze` and is
    no longer a step of its own: a caller that still asks for it — an
    old dashboard, a shell history entry, a queue-config left over from
    before — is refused by the same --command check every other unknown
    word meets, before any money is spent."""
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="review-plan")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "Invalid --command" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
