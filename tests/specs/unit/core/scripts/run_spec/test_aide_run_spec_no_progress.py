"""A step that claimed it finished, measured against what it actually
changed: the guards that downgrade such a claim, per step, and the ones
that leave a genuine run alone.

Split out of test_aide_run_spec_claims.py 2026-09-04; the tests are
unchanged and keep their names.
"""

import json
import re
import subprocess
import pytest
import pytest
from .run_spec_invoking import create
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import analyze_claude_advancing_row, analyze_claude_naming_implement, analyze_claude_renaming_the_header, analyze_claude_writing_the_line_from_nothing, project_only_claude, specs_foreign_folder_claude, specs_only_claude, writing_claude
from .run_spec_origins import origin
from .run_spec_project_state import BASH_ERROR_REGISTRY
from .run_spec_results import RESULT_OK
from .run_spec_status_files import conflicting_branch, recorded_line, status_with_phase, tracked_specs_inside_project_workspace, with_status, write_raw_status


def test_a_completed_claim_with_no_project_change_at_all_is_downgraded(
    runner, workspace, fake_claude
):
    """AC5: the CLI reports success, but the child touched neither the
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
    failure (488, 491, 2026-09-18). Measured against the project's
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

def test_a_genuine_implement_run_is_unaffected(runner, workspace, fake_claude):
    """AC6: the project changed AND a row is ticked — exactly today's
    behavior for a real run, unaffected by the new check."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |", "| b | ⬜ | |"])
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

def test_archive_no_progress_guard_downgrades_when_the_folder_never_moved(
    runner, workspace, fake_claude
):
    """AC3. The archive precheck meets an OPEN conflict (so the model is
    spawned at all — `conflict-open` is not a skip-the-model outcome),
    the step resolves it and reports `completed`, but the spec folder
    itself was never actually moved under `archive/` — the exact shape
    spec 278 produced."""
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
    assert out["ok"] is False, out
    assert out["terminalReason"] == "no-progress", out
    assert "never moved to archive" in out["error"], out
    assert recorded_line(workspace) == "create, analyze, implement"

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
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.write_text(
        status_path.read_text()
        + "\n## Acceptance criteria\n\n"
        + "| Task | Status | Notes |\n|------|--------|-------|\n"
        + "| REQ-1: does the thing | ⬜ | |\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add acceptance criteria")
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

def test_a_genuine_archive_run_is_unaffected(runner, workspace, fake_claude):
    """AC4. The spec folder genuinely moves under `archive/` (the
    mechanical pre-check's own `archived` outcome, since `implement` is
    on the line and nothing conflicts) — `terminalReason` stays
    `completed` and `archive` is added to the line, unaffected by the
    new check."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert (
        recorded_line(workspace, path=f"archive/{folder}/4-status.md")
        == "create, analyze, implement, archive"
    )

@pytest.mark.parametrize("step", ["create", "analyze", "implement"])
def test_archive_no_progress_guard_never_fires_for_other_steps(
    runner, workspace, fake_claude, step
):
    """AC5. The new check is `archive`-specific — mirrors
    `test_no_progress_is_scoped_to_implement_only` above, extended to
    the sibling check `archive` gained. None of these three steps moves
    the spec folder, so if the check were not scoped to
    `command_name = archive` it would wrongly downgrade every one of
    them."""
    if step == "create":
        claude = fake_claude(
            "cat > /dev/null\n"
            + READ_SPECS
            + 'mkdir -p "$specs/new-abc123de"\n'
            + 'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** `new-abc123de/`" '
            + '> "$specs/new-abc123de/4-status.md"\n'
            + f"echo '{json.dumps(RESULT_OK)}'"
        )
        rc, out, _ = create(runner, workspace, claude)
    elif step == "analyze":
        with_status(workspace)
        claude = specs_only_claude(fake_claude, workspace)
        rc, out, _ = run(runner, workspace, claude, command="analyze")
    else:
        status_with_phase(workspace, "create, analyze", ["| a | ✅ | |"])
        claude = project_only_claude(fake_claude)
        rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_an_analyze_claim_that_changed_the_project_repo_is_downgraded(
    runner, workspace, fake_claude
):
    """AC1/REQ-1: spec 284's own incident — the CLI reports success, but
    the child left a real change in the project repo, which analyze must
    never do."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert recorded_line(workspace) == "create"

@pytest.mark.parametrize("mark", ["✅", "🔄", "❌", "⚠️"])
def test_an_analyze_claim_that_advances_a_phase_row_is_downgraded(
    runner, workspace, fake_claude, mark
):
    """AC2/REQ-1, REQ-2: a Phase-table row moved off "not started" during
    an analyze run — that is implement's and archive's job — parametrized
    over every non-not-started mark a row could end up carrying."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = analyze_claude_advancing_row(fake_claude, workspace, mark)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out

def test_an_analyze_claim_that_names_implement_on_the_line_is_downgraded(
    runner, workspace, fake_claude
):
    """AC3/REQ-2: the project did not change and no row advanced, but the
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
    """Spec 348's refusal: the file had no steps line before the run, so
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
    """REQ-1 regression (the description's own bug): renaming a Phase
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
    """AC4/REQ-3: the actual trust hole — a step's own session writes a
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
    """AC5/REQ-1, REQ-2 (regression): a real analyze run — writes only
    2-analysis.md/3-solution.md, touches nothing in the project, and
    leaves the Phase-table row exactly as it found it — is unaffected by
    the new checks, mirroring spec 268's own AC6."""
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

def test_every_bash_error_sentence_has_a_resolution_or_a_named_exemption(runner, run_spec_source):
    """REQ-7: "A test SHALL fail for an error sentence that carries no
    resolution, over the set of sentences the board can show" — this is
    that check for the bash-authored half of the set. Each registry entry
    names a literal or regex fragment expected in the script's own source
    and either a `resolve` substring the matched text must contain, or an
    `exempt` reason there is genuinely nothing to resolve."""
    source = run_spec_source
    for entry in BASH_ERROR_REGISTRY:
        match = re.search(entry["pattern"], source)
        assert match, f"{entry['name']}: pattern not found in {runner}"
        resolve, exempt = entry.get("resolve"), entry.get("exempt")
        assert resolve or exempt, f"{entry['name']}: has neither resolve nor exempt"
        if resolve:
            assert resolve in match.group(0), f"{entry['name']}: {resolve!r} not in {match.group(0)!r}"

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

def test_a_run_that_creates_another_spec_folder_is_downgraded_and_the_folder_discarded(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = specs_foreign_folder_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "999-made-by-the-run" in out["error"], out
    assert "press Analyze again" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "999-made-by-the-run" not in tree, tree
    assert f"{workspace['folder']}/2-analysis.md" in tree, tree

def test_a_run_that_deletes_another_spec_folder_is_downgraded_and_the_folder_restored(
    runner, workspace, fake_claude
):
    other = workspace["specs"] / "80-neighbour"
    other.mkdir()
    (other / "1-description.md").write_text("# 80\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add a neighbour")
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + 'rm -rf "$specs/80-neighbour"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "scope-violation", out
    assert "80-neighbour" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "80-neighbour/1-description.md" in tree, tree

def test_a_neighbour_archived_on_main_and_merged_in_is_not_the_steps_own_write(
    runner, workspace, fake_claude
):
    """Another spec is archived on the default branch while this step
    runs, and the step merges that branch in: the neighbour's move comes
    with the merge, and is the default branch's, not this step's."""
    other = workspace["specs"] / "80-neighbour"
    other.mkdir()
    (other / "1-description.md").write_text("# 80\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add a neighbour")
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    main_specs = workspace["specs"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'mkdir -p "{main_specs}/archive" && git -C "{main_specs}" mv 80-neighbour archive/80-neighbour\n'
        + f'git -C "{main_specs}" commit -qm "archive the neighbour"\n'
        + 'git -C "$specs" merge -q --no-edit main\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_writes_only_its_own_folder_is_not_a_scope_violation(runner, workspace, fake_claude):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" >> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_writes_only_its_own_folder_is_not_a_scope_violation_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-2: specs TRACKED inside the project's own repository — the
    layout the description names, where `specs_repo == project_root`. An
    analyze step that writes only its own spec folder there must
    complete, not be downgraded because `git status` on the whole project
    worktree sees that folder's own legitimate change."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_creates_another_spec_folder_is_downgraded_and_the_folder_discarded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-3: a foreign spec folder written under the same TRACKED,
    inside-the-project specs root is still caught and reverted —
    run-spec-specs-guard.sh's own existing behavior, now reached for this
    layout because the false positive that used to pre-empt it is gone."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'mkdir -p "$PWD/specs/999-made-by-the-run" && echo "# 999" > "$PWD/specs/999-made-by-the-run/1-description.md"\n'
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "999-made-by-the-run" in out["error"], out
    tree = git(ws["project"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "999-made-by-the-run" not in tree, tree
    assert f"specs/{folder}/2-analysis.md" in tree, tree

def test_an_analyze_claim_that_changed_the_project_repo_is_downgraded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-4 regression: a step that writes a real project file OUTSIDE
    the specs root, in the tracked-inside-project layout, is still
    stopped — exactly as it is today."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def test_an_analyze_that_commits_its_own_folder_is_not_a_scope_violation_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """The HEAD half of the same rule. A session that COMMITS its own
    spec folder, where the specs live inside the project's repository,
    moves the project's HEAD — and "HEAD moved" was read as "the project
    changed", so every such analyze stopped on scope-violation with the
    plan it had written sitting on the branch (paceup 02, 2026-09-18).
    What moved is the step's own folder, which is the whole point of it."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f'git add "specs/{folder}" && git -c user.email=a@b -c user.name=a commit -qm "analysis"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_an_analyze_that_commits_a_project_file_is_still_downgraded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """The same commit carrying a file OUTSIDE the specs root is the
    violation it always was: the exception is the step's own folder,
    never "anything, as long as it was committed"."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + 'git add new-code.txt && git -c user.email=a@b -c user.name=a commit -qm "code"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    # It says what was committed, in those words — not "uncommitted".
    assert "(committed: new-code.txt" in out["error"], out


def test_an_archive_claim_over_not_verified_acceptance_rows_is_not_refused_AC_8(
    runner, workspace, fake_claude
):
    """The runner's archive pre-check reads a Not verified Acceptance row
    as done, so it does not answer `acceptance-criteria-unticked`."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.write_text(
        status_path.read_text()
        + "\n## Acceptance criteria\n\n"
        + "| Task | Status | Notes |\n|------|--------|-------|\n"
        + "| REQ-1: does the thing | Not verified | Not tested: x |\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add acceptance criteria")
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


# --- an archive that rewrites the wiki pages its own spec touched -----------
# The new `wiki/` exception in run-spec-specs-guard.sh (archive-only), and
# the precision check in run-spec-wiki-guard.sh that recomputes the
# allowed pages fresh via `aide-wiki affected` and takes back anything
# else — never trusting what the session claims it rewrote.

ARCHIVE_BRANCH = "aide/81-queue-and-runner"


def _wiki_bin(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-wiki"


def _write_wiki_page(workspace_root, specs, project, name, files):
    wiki = _wiki_bin(workspace_root)
    args = [str(wiki), "write", "--specs-root", str(specs), "--project-dir", str(project), "--page", name]
    for f in files:
        args += ["--file", f]
    proc = subprocess.run(args, input=f"# {name}\n\nAbout {name}.\n", capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


def _archive_wiki_workspace(workspace, workspace_root):
    """A project with two generated wiki pages (`p.md` over `x.txt`,
    `q.md` over `y.txt`) and one hand-written page (`notes.md`), then the
    spec's own branch already carrying an `implement`-shaped commit
    (`_branch_with_earlier_implement_code`'s own shape) that changes
    `x.txt` alone — `p.md` is this spec's own diff, `q.md` is not."""
    project = workspace["project"]
    specs = workspace["specs"]
    (project / "x.txt").write_text("x\n")
    (project / "y.txt").write_text("y\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "add x and y")
    _write_wiki_page(workspace_root, specs, project, "p.md", ["x.txt"])
    _write_wiki_page(workspace_root, specs, project, "q.md", ["y.txt"])
    (specs / "wiki" / "notes.md").write_text("# Notes\n\nWritten by a person.\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "seed the wiki")
    git(project, "switch", "-q", "-c", ARCHIVE_BRANCH)
    (project / "x.txt").write_text("x, changed by implement\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "implement")
    git(project, "switch", "-q", "main")
    return ARCHIVE_BRANCH


def _wiki_page(workspace, branch, name):
    return git(workspace["specs"], "show", f"{branch}:wiki/{name}")


def test_an_archive_rewrites_the_page_covering_its_own_changed_file_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# P\\n\\nRewritten.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page p.md --file x.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    text = _wiki_page(workspace, branch, "p.md")
    assert "Rewritten." in text
    head = git(workspace["project"], "rev-parse", branch)
    assert f"commit: {head}" in text
    assert "wiki pages rewritten: p.md" in err


def test_an_archive_that_touches_no_wiki_page_leaves_it_unchanged_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = {name: _wiki_page(workspace, "main", name) for name in ("p.md", "q.md", "notes.md")}
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    for name, text in before.items():
        assert _wiki_page(workspace, branch, name) == text
    assert "wiki pages rewritten: none" in err


def test_a_page_main_changed_while_the_archive_ran_is_not_the_archives_write(
    runner, workspace, workspace_root, fake_claude, origin
):
    """Another run lands a new `schema.md` on the default branch while
    this archive runs — a page an archive may never write. The archive's
    branch still has the older wiki, which is main moving on, not the
    archive writing it."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    _archive_wiki_workspace(workspace, workspace_root)
    specs = workspace["specs"]
    git(specs, "push", "-q", "origin", "main")
    moved = (
        f'echo "# Schema" > "{specs}/wiki/schema.md"\n'
        f'git -C "{specs}" add wiki/schema.md\n'
        f'git -C "{specs}" commit -qm "another run\'s wiki refresh"\n'
        f'git -C "{specs}" push -q origin main\n'
    )
    claude = fake_claude("cat > /dev/null\n" + moved + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["terminalReason"] == "completed", out.get("error")


def test_an_archive_that_writes_a_page_outside_its_own_diff_is_taken_back_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page whose own file the spec never touched (`q.md`, over `y.txt`)
    rewritten anyway — the guard's own recomputed answer, not the
    session's claim, decides what stays."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "q.md")
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# Q\\n\\nRewritten anyway.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page q.md --file y.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "q.md" in out["error"], out
    assert _wiki_page(workspace, branch, "q.md") == before


def test_an_archive_that_creates_a_brand_new_unaffected_page_is_taken_back_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page that never existed before this run is UNTRACKED at the
    point the guard checks it — `git diff` alone is silent about an
    untracked file, so a check built on `git diff --quiet` misses it
    unless it also looks at `git status`."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# New\\n\\nUnrelated.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page new.md --file y.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "new.md" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", branch).split()
    assert "wiki/new.md" not in tree, tree


def test_an_archive_that_deletes_an_unaffected_page_is_restored_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page the run DELETED is absent from `wiki/`'s own listing
    afterward — a check that only globs what remains on disk never
    visits it, so the deletion would otherwise land unnoticed."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "q.md")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'rm "$specs/wiki/q.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "q.md" in out["error"], out
    assert _wiki_page(workspace, branch, "q.md") == before


def test_an_archive_that_edits_a_hand_written_page_is_taken_back_AC_3(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "notes.md")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "edited by the step" >> "$specs/wiki/notes.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "notes.md" in out["error"], out
    assert _wiki_page(workspace, branch, "notes.md") == before


def _records_a_decision(workspace_root, spec, page="decision-x.md"):
    """A session that records one decision about `q.md` and rebuilds the index."""
    wiki = _wiki_bin(workspace_root)
    return (
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "A build never sees a decision.\\n" | {wiki} decision --specs-root "$specs" '
        + f'--page {page} --spec {spec} --title "Keep decisions" --decision "A decision is a hand-written page." '
        + '--concerns q.md >/dev/null\n'
        + f'{wiki} index --specs-root "$specs" --project-dir "$PWD" >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_archive_that_records_a_decision_lands_its_page_its_link_back_and_the_index_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    claude = fake_claude(_records_a_decision(workspace_root, workspace["folder"]))
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "completed", out
    page = _wiki_page(workspace, branch, "decision-x.md")
    assert f"spec: {workspace['folder']}" in page and "A decision is a hand-written page." in page
    assert "](decision-x.md)" in _wiki_page(workspace, branch, "q.md")
    assert "](decision-x.md)" in _wiki_page(workspace, branch, "index.md")
    assert "wiki decisions recorded: decision-x.md" in err


def test_a_decision_on_a_page_main_rewrote_while_the_archive_ran_is_kept(
    runner, workspace, workspace_root, fake_claude, origin
):
    """A wiki refresh lands a rewrite of `q.md` on the default branch while
    this archive records a decision about it. The archive's branch still
    has the older `q.md` body under its new `## Decisions` section, which
    is main moving on, not the archive rewriting the page."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    specs = workspace["specs"]
    git(specs, "push", "-q", "origin", "main")
    git(workspace["project"], "push", "-q", "origin", "main")
    moved = (
        f'sed -i "" "s/About q.md./Rewritten on main./" "{specs}/wiki/q.md"\n'
        f'git -C "{specs}" commit -qam "a wiki refresh"\n'
        f'git -C "{specs}" push -q origin main\n'
    )
    claude = fake_claude(moved + _records_a_decision(workspace_root, workspace["folder"]))
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["terminalReason"] == "completed", out.get("error")
    assert "](decision-x.md)" in _wiki_page(workspace, branch, "q.md")


def test_an_archive_whose_decision_page_names_another_spec_is_taken_back_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    (workspace["specs"] / "80-neighbour").mkdir()
    (workspace["specs"] / "80-neighbour" / "1-description.md").write_text("# Neighbour\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "another spec")
    before = _wiki_page(workspace, "main", "q.md")
    claude = fake_claude(_records_a_decision(workspace_root, "80-neighbour"))
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False and out["terminalReason"] == "scope-violation", out
    assert "decision-x.md" in out["error"], out
    assert "wiki/decision-x.md" not in git(workspace["specs"], "ls-tree", "-r", "--name-only", branch).split()
    assert _wiki_page(workspace, branch, "q.md") == before


def test_a_non_archive_step_writing_the_wiki_is_still_a_scope_violation(
    runner, workspace, fake_claude
):
    """The new `wiki/` exception in run-spec-specs-guard.sh is
    `archive`-only, by the literal command string — mirrors
    `test_archive_no_progress_guard_never_fires_for_other_steps` above,
    inverted: an unrelated step must never be able to write the wiki
    undetected, or the guard's whole purpose is defeated (the guard
    file's own comment, spec 366)."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    (workspace["specs"] / "wiki").mkdir()
    (workspace["specs"] / "wiki" / "p.md").write_text("# P\n\nSeed.\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "seed the wiki")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "changed by analyze" >> "$specs/wiki/p.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def test_an_archive_in_a_project_with_no_wiki_is_unaffected_AC_5(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert not (workspace["specs"] / "wiki").exists()



def test_an_archive_rewrites_a_page_covering_a_file_it_deleted_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    """The rewrite drops the deleted file from the page's own list, so the
    page no longer names anything the spec changed once it is rewritten.
    What the page named before the rewrite is what lets it stay."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    project, specs = workspace["project"], workspace["specs"]
    (project / "gone.txt").write_text("gone\n")
    (project / "kept.txt").write_text("kept\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "add two files")
    _write_wiki_page(workspace_root, specs, project, "r.md", ["gone.txt", "kept.txt"])
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "seed the wiki")
    git(project, "switch", "-q", "-c", ARCHIVE_BRANCH)
    git(project, "rm", "-q", "gone.txt")
    git(project, "commit", "-q", "-m", "implement")
    git(project, "switch", "-q", "main")
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# R\\n\\nRewritten.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page r.md --file kept.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert "Rewritten." in _wiki_page(workspace, ARCHIVE_BRANCH, "r.md")
    assert "wiki pages rewritten: r.md" in err
