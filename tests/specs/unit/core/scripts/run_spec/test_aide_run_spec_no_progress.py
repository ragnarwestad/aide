"""A step that claimed it finished, measured against what it actually
changed: the guards that downgrade such a claim, per step, and the ones
that leave a genuine run alone.

Split out of test_aide_run_spec_claims.py 2026-09-04; the tests are
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
import pytest
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import analyze_claude_advancing_row, analyze_claude_naming_implement, analyze_claude_renaming_the_header, analyze_claude_writing_the_line_from_nothing, project_only_claude, specs_foreign_folder_claude, specs_only_claude, writing_claude
from .run_spec_invoking import create
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
    claude = project_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_a_genuine_implement_run_is_unaffected(runner, workspace, fake_claude):
    """AC6: the project changed AND a row is ticked — exactly today's
    behavior for a real run, unaffected by the new check."""
    status_with_phase(workspace, "create, analyze", ["| a | ✅ | |", "| b | ⬜ | |"])
    claude = project_only_claude(fake_claude, workspace)
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
            + 'mkdir -p "$specs/99-a-brand-new-spec"\n'
            + 'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** `99-a-brand-new-spec/`" '
            + '> "$specs/99-a-brand-new-spec/4-status.md"\n'
            + f"echo '{json.dumps(RESULT_OK)}'"
        )
        rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    elif step == "analyze":
        with_status(workspace)
        claude = specs_only_claude(fake_claude, workspace)
        rc, out, _ = run(runner, workspace, claude, command="analyze")
    else:
        status_with_phase(workspace, "create, analyze", ["| a | ✅ | |"])
        claude = project_only_claude(fake_claude, workspace)
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
    claude = project_only_claude(fake_claude, workspace)
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
