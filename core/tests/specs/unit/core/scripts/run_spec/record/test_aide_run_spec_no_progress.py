"""A step that claimed it finished, measured against what it actually
changed: the guards that downgrade such a claim, per step, and the ones
that leave a genuine run alone."""

import json
import re
import shlex
import subprocess
from ...conftest import READ_SPECS, git, run
from ..run_spec_fakes import analyze_claude_advancing_row, analyze_claude_naming_implement, analyze_claude_renaming_the_header, analyze_claude_writing_the_line_from_nothing, project_only_claude, writing_claude
from ..run_spec_origins import origin
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import acceptance_section, conflicting_branch, recorded_line, status_with_phase, with_acceptance, with_status, write_raw_status
from ..run_spec_result_fields import assert_written_as_in_fixture


def test_a_completed_claim_with_no_project_change_at_all_is_downgraded(
    runner, workspace, fake_claude
):
    """The CLI reports success, but the child touched neither the
    project nor the specs repo at all."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out
    assert recorded_line(workspace) == "create, analyze"

def _branch_with_earlier_implement_code(workspace):
    """The spec's branch already holding code an earlier implement wrote
    — a run stopped on the clock or on red tests leaves it there."""
    project = workspace["project"]
    branch = "aide/81-queue-and-runner"
    git(project, "switch", "-q", "-c", branch)
    (project / "feature.txt").write_text("written by the earlier run\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "earlier implement")
    git(project, "switch", "-q", "main")
    return branch


def test_a_rerun_over_code_already_on_the_branch_is_not_no_progress(
    runner, workspace, fake_claude
):
    """An earlier implement stopped on the clock or on red tests, its code
    on the branch. Pressed again, the session finds the work done, sees
    the tests green and changes nothing — and the step is done, not a
    failure. Measured against the project's
    default branch, not only against this run's own start."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |"])
    _branch_with_earlier_implement_code(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze, implement"


def test_a_branch_holding_only_what_main_has_is_still_no_progress(
    runner, workspace, fake_claude
):
    """The branch exists but adds nothing to the project beyond main: a
    run that changes nothing is still no progress."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    git(workspace["project"], "branch", "aide/81-queue-and-runner")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out


def test_a_completed_claim_that_ticks_no_row_still_counts(
    runner, workspace, fake_claude
):
    """The project genuinely changed, but not one task row moved off
    unstarted — and that is NOT a failure.

    A Phase table is the run's own record of its work, and nothing gates
    on it: archive's only gate is the `## Acceptance criteria` section.
    Failing a step that changed real code because its bookkeeping lagged
    turned a record-keeping slip into a red run someone had to
    re-drive."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |", "| b | ⬜ | |"])
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_no_progress_is_scoped_to_implement_only(runner, workspace, fake_claude):
    """The check is `implement`-specific: an `analyze` run that changes
    nothing in the project repo is exactly today's ordinary case (analyze
    never touches the project), not a new failure mode this spec
    introduces."""
    with_status(workspace)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_archive_post_check_finishes_an_eligible_folder_the_session_never_moved(
    runner, workspace, fake_claude
):
    """The archive precheck meets an OPEN conflict (so the model is
    spawned at all — `conflict-open` is not a skip-the-model outcome),
    the step resolves it and reports `completed`, but the spec folder
    itself was never actually moved under `archive/` — the exact shape
    an earlier run produced."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    conflicting_branch(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(
        workspace, path=f"archive/{workspace['folder']}/4-status.md"
    ) == "create, analyze, implement, archive"

def _archive_claim_after_resolving_a_conflict(runner, workspace, fake_claude):
    """The shape both refusal tests share: the pre-session check meets an
    OPEN conflict (so the session is spawned), the session resolves it
    and reports `completed` — while `aide-archive-spec`, asked by the
    session, refused to move the folder."""
    conflicting_branch(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'printf "resolved by the step\\n" > contested.txt\n'
        "git add -A\n"
        "git commit -q --no-edit\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    return run(runner, workspace, claude, command="archive")

def test_an_archive_claim_over_unticked_acceptance_criteria_is_that_refusal(
    runner, workspace, fake_claude
):
    """A folder that stayed put because the script REFUSED (an unticked
    `## Acceptance criteria` row) is that refusal — ok, held back, the
    same answer the pre-session check gives when no conflict is in the
    way — never a red `no-progress` beside a held-back row (427,
    2026-09-09)."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    with_acceptance(workspace, acceptance_section(["| REQ-1: does the thing | ⬜ | |"]), {})
    rc, out, _ = _archive_claim_after_resolving_a_conflict(runner, workspace, fake_claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert "error" not in out or not out["error"], out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_an_archive_claim_before_implement_is_not_implemented_yet(
    runner, workspace, fake_claude
):
    """The other refusal the script answers on its own, asked in the
    script's own order: no `implement` on the line is
    `not-implemented-yet`, whatever the session claimed."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |"])
    rc, out, _ = _archive_claim_after_resolving_a_conflict(runner, workspace, fake_claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "not-implemented-yet", out
    assert recorded_line(workspace) == "create, analyze"

def test_an_analyze_claim_that_changed_the_project_repo_is_downgraded(
    runner, workspace, fake_claude
):
    """A real incident — the CLI reports success, but
    the child left a real change in the project repo, which analyze must
    never do."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert out["scopeViolation"] == "analyze", out
    assert_written_as_in_fixture("scopeAnalyze", out["scopeAnalyze"])
    assert out["scopeAnalyze"] == {
        "project": {"committed": [], "uncommitted": ["new-code.txt"]},
        "phaseRows": False,
        "workflowSteps": False,
    }, out
    assert recorded_line(workspace) == "create"

def test_analyze_scope_keeps_a_changed_path_with_spaces_whole(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'mkdir -p "$PWD/src"\n'
        + 'echo "written by the step" > "$PWD/src/my file.ts"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert_written_as_in_fixture("scopeAnalyze", out["scopeAnalyze"])
    assert out["scopeAnalyze"]["project"]["uncommitted"] == ["src/my file.ts"], out

def test_an_analyze_claim_that_advances_a_phase_row_is_downgraded(
    runner, workspace, fake_claude
):
    """A Phase-table row moved off "not started" during
    an analyze run — that is implement's and archive's job."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_advancing_row(fake_claude, workspace, "✅")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out

def test_an_analyze_claim_that_names_implement_on_the_line_is_downgraded(
    runner, workspace, fake_claude
):
    """The project did not change and no row advanced, but the
    raw `Workflow steps completed` line itself names a step beyond
    analyze that the pre-session line did not already carry."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_naming_implement(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out

def test_an_analyze_that_names_create_on_a_line_that_did_not_exist_is_fine(
    runner, workspace, fake_claude
):
    """A past refusal: the file had no steps line before the run, so
    the allowed set was `analyze` alone and the model's own `create` read
    as a step beyond scope. A spec that exists has been through create."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Last updated:** `[not started]`\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| a | ⬜ | |\n",
    )
    claude = analyze_claude_writing_the_line_from_nothing(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_an_analyze_run_that_renames_the_header_columns_is_unaffected(
    runner, workspace, fake_claude
):
    """Regression (the description's own bug): renaming a Phase
    table's header away from `Task | Status | Notes` must never itself
    count as an advanced row, or a genuine no-op analyze run is wrongly
    downgraded to scope-violation."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_renaming_the_header(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_completed_steps_for_ignores_a_step_the_current_sessions_own_edit_added(
    runner, workspace, fake_claude
):
    """The actual trust hole — a step's own session writes a
    LATER step's name onto the Workflow-steps-completed line, unsupported
    by the commit history or by what the line said before this session
    ran. The timing fix (`existing_line` read from BEFORE this session,
    not after) means that unsupported name is dropped rather than granted
    permanent credit for a step that never actually happened."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |", "| b | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'sed "s/create, analyze/create, analyze, implement, archive/" '
        + f'"$specs/{folder}/4-status.md" > "$specs/{folder}/4-status.md.new"\n'
        + f'mv "$specs/{folder}/4-status.md.new" "$specs/{folder}/4-status.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_a_genuine_analyze_run_is_unaffected(runner, workspace, fake_claude):
    """Regression: a real analyze run — writes only
    2-analysis.md/3-solution.md, touches nothing in the project, and
    leaves the Phase-table row exactly as it found it — is unaffected by
    the new checks."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{folder}/2-analysis.md"\n'
        + f'echo "solution" > "$specs/{folder}/3-solution.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze"

def test_a_local_branch_origin_no_longer_has_is_not_reused(runner, workspace, fake_claude, origin):
    """A branch that landed and was deleted on origin can linger locally
    with commits of its own (a stopped archive's note, a killed run).
    Cutting the next run from it carried a status file that said
    "create, analyze" about specs whose implement had long landed, and
    every archive was refused on it (351, 356 — 2026-09-03)."""
    branch = "aide/81-queue-and-runner"
    project = workspace["project"]
    subprocess.run(["git", "-C", str(project), "checkout", "-q", "-b", branch], check=True)
    (project / "stale.txt").write_text("left behind\n")
    subprocess.run(["git", "-C", str(project), "add", "stale.txt"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "stale local commit"], check=True)
    # It once tracked origin — that is what tells a leftover from a
    # branch nobody ever pushed.
    subprocess.run(["git", "-C", str(project), "config", f"branch.{branch}.remote", "origin"], check=True)
    subprocess.run(["git", "-C", str(project), "config", f"branch.{branch}.merge", f"refs/heads/{branch}"], check=True)
    subprocess.run(["git", "-C", str(project), "checkout", "-q", "main"], check=True)
    assert git(origin["project"], "branch", "--list", branch) == ""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, push="branch", command="implement")
    assert rc == 0, out
    log = git(origin["project"], "log", "--pretty=%s", branch)
    assert "stale local commit" not in log, "the run was cut from the stale local branch"

def test_an_archive_claim_over_not_verified_acceptance_rows_is_not_refused(
    runner, workspace, fake_claude
):
    """The runner's archive pre-check reads a Not verified Acceptance row
    as done, so it does not answer `acceptance-criteria-unticked`."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    with_acceptance(workspace, acceptance_section(["| REQ-1: does the thing | Not verified | Not tested: x |"]), {})
    rc, out, _ = _archive_claim_after_resolving_a_conflict(runner, workspace, fake_claude)
    assert out["terminalReason"] != "acceptance-criteria-unticked", out


NOT_TESTED_ANALYZE_BODY = (
    "# Queue - Status\n\n## Tracking info\n\n"
    "- **Task:** `{folder}/`\n"
    "- **Workflow steps completed:** create\n"
    "- **Total progress:** 0% (0 of 1 completed)\n\n---\n\n"
    "## Phase 1: RED\n\n"
    "| Task | Status | Notes |\n|------|--------|-------|\n"
    "| a | ⬜ | |\n\n"
    "## Acceptance criteria\n\n"
    "| Task | Status | Notes |\n|------|--------|-------|\n"
    "| AC-1: one | ⬜ | Not tested: needs the deploy; check the page |\n"
    "| AC-2: two | ⬜ | |\n"
)


def _analyze_writing_status(fake_claude, workspace, body):
    folder = workspace["folder"]
    return fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'cat > "$specs/{folder}/4-status.md" <<\'STATUSEOF\'\n'
        + body.format(folder=folder)
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def _branch_status(workspace):
    """4-status.md as the step's own commit has it."""
    return git(
        workspace["specs"], "show",
        f"aide/81-queue-and-runner:{workspace['folder']}/4-status.md",
    )


# Not verified is the user's mark alone. An analyze that writes a
# "Not tested:" row leaves it open, and the step's commit carries it so.
def test_an_analyze_run_leaves_a_not_tested_row_open(runner, workspace, fake_claude):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = _analyze_writing_status(fake_claude, workspace, NOT_TESTED_ANALYZE_BODY)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    text = _branch_status(workspace)
    assert "| AC-1: one | ⬜ | Not tested: needs the deploy; check the page |" in text
    assert "Not verified" not in text


def _claude_saying(fake_claude, *texts):
    """A session that changes nothing, writes each text as its own
    assistant message and then claims success."""
    lines = ["cat > /dev/null"]
    for text in texts:
        event = {"type": "assistant", "parent_tool_use_id": None,
                 "message": {"content": [{"type": "text", "text": text}]}}
        lines.append(f"printf '%s\\n' {shlex.quote(json.dumps(event))}")
    lines.append(f"echo '{json.dumps(RESULT_OK)}'")
    return fake_claude("\n".join(lines))


def test_a_no_progress_implement_carries_the_reason_the_session_stopped_with_ac_1_ac_4(
    runner, workspace, fake_claude
):
    """The session changed nothing and said why in its own step mark: the
    stop stays no-progress, and the result carries that reason."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = _claude_saying(
        fake_claude,
        "--- Step 1 of 4: Preparation — started",
        "--- Step 1 of 4: Preparation — stopped: the failure could not be reproduced",
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out
    assert out["noProgressReason"] == "the failure could not be reproduced", out


def test_the_first_stopped_or_skipped_reason_is_the_one_carried_ac_1(
    runner, workspace, fake_claude
):
    """A skip before a stop: the first reason is the one quoted."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = _claude_saying(
        fake_claude,
        "Looked into it.\n--- Step 2 of 4: RED — Write failing tests — skipped: no cause found",
        "--- Step 3 of 4: GREEN — Implement until tests pass — stopped: later",
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["noProgressReason"] == "no cause found", out


def test_a_long_reason_is_carried_whole_ac_1(runner, workspace, fake_claude):
    """The reason is the session's own words, never cut."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    reason = "the failure could not be reproduced " + "on any run " * 40
    reason = reason.strip()
    assert len(reason) > 300
    claude = _claude_saying(fake_claude, f"--- Step 1 of 4: Preparation — stopped: {reason}")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["noProgressReason"] == reason, out


def test_a_no_progress_implement_without_a_reason_carries_none_ac_3(
    runner, workspace, fake_claude
):
    """Marks with no stop or skip leave the result without a reason, so the
    board keeps today's sentence."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = _claude_saying(
        fake_claude,
        "--- Step 1 of 4: Preparation — started",
        "--- Step 1 of 4: Preparation — done",
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "no-progress", out
    assert "noProgressReason" not in out, out


def test_a_reason_that_itself_quotes_a_stop_is_carried_whole_ac_1(
    runner, workspace, fake_claude
):
    """The reason is taken from the mark's first stop, not its last."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    reason = "the log still says — stopped: database unavailable"
    claude = _claude_saying(fake_claude, f"--- Step 1 of 4: Preparation — stopped: {reason}")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["noProgressReason"] == reason, out
