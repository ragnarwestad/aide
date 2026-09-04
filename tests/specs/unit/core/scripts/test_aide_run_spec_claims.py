"""aide-run-spec: a landed step measured against its own claim, the progress header, and the sentences the script may show.

One part of a suite that was one 7348-line file until 2026-09-04;
the tests are unchanged and keep their names. What they share sits
in conftest.py beside them.
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
from .conftest import (
    BASH_ERROR_REGISTRY,
    CODE_LANDING,
    READ_SPECS,
    RESULT_OK,
    STATUS_ROW_COUNTING,
    analyze_claude_advancing_row,
    analyze_claude_naming_implement,
    analyze_claude_renaming_the_header,
    analyze_claude_writing_the_line_from_nothing,
    bullet,
    configure_code_landing,
    conflicting_branch,
    create,
    git,
    phase_file_text,
    project_only_claude,
    recorded_line,
    run,
    run_with_gh,
    specs_foreign_folder_claude,
    specs_only_claude,
    status_with_phase,
    with_status,
    write_raw_status,
    writing_claude,
)

@pytest.mark.parametrize("case", CODE_LANDING, ids=[c["name"] for c in CODE_LANDING])
def test_the_code_landing_decides_the_default_push_mode(
    runner, workspace, fake_claude, fake_gh, origin, case
):
    """The `push` column of the shared table: what a run with no `--push`
    on its command line ends up using. `pr` in the manifest is the only
    value that changes anything — every other spelling, and the absence
    of the key, leaves the hand-run default of `none` exactly as it was.
    """
    configure_code_landing(workspace, case["manifest"], case["config"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _, err = run_with_gh(
        runner, workspace, claude, fake_gh(), push=None, return_stderr=True
    )
    assert rc == 0, out
    assert out["push"] == case["push"], f"{case['name']}: {err}"
    if case["push"] == "pr":
        # Said out loud, the way the worktree links report their source:
        # a value that changes how a run publishes must not do it in
        # silence.
        assert "codeLanding" in err, err

def test_a_typed_push_mode_beats_the_manifest(
    runner, workspace, fake_claude, fake_gh, origin
):
    """The manifest supplies a DEFAULT, not an override. A person typing
    `--push branch` at a terminal has said what they want, and a file
    quietly overruling it is the shape of a run nobody can steer."""
    configure_code_landing(workspace, "pr", None)
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push="branch")
    assert rc == 0, out
    assert out["push"] == "branch", out
    assert not fake_gh.calls.exists(), "gh is only for `pr`"

def test_a_pr_landing_opens_the_pull_request(runner, workspace, fake_claude, fake_gh, origin):
    """The whole reason the default is forced rather than merely allowed:
    without a pull request there is nothing for the dashboard to leave
    open, so the two halves must travel together."""
    configure_code_landing(workspace, "pr", None)
    claude = writing_claude(fake_claude, workspace)
    gh = fake_gh()
    rc, out, _ = run_with_gh(runner, workspace, claude, gh, push=None)
    assert rc == 0, out
    assert fake_gh.calls.exists(), "a pr landing must open one"
    assert out["prUrl"], out

def test_open_rows_recompute_the_header_percentage(runner, workspace, fake_claude):
    """AC1: a header reading `0% (0 of 4 completed)` next to 4 real rows
    (2 done, 2 open) is rewritten to the real split."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 4 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| one | ✅ | |\n"
        "| two | ✅ | |\n"
        "| three | ⬜ | |\n"
        "| four | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (2 of 4 completed)"

def test_a_header_that_already_matches_is_not_rewritten(runner, workspace, fake_claude):
    """AC2: a header already agreeing with the real row count produces no
    change and no commit — the same `cmp -s` guard `Workflow steps
    completed` already uses."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 13))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Workflow steps completed:** analyze\n"
        "- **Total progress:** 100% (12 of 12 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    # spec 355: see the matching comment on
    # test_a_line_that_is_already_right_is_not_rewritten above — the
    # ONE genuinely new file is this fixture's first-ever 4-status.json.
    assert roots[str(workspace["specs"])]["changedFiles"] == 1

def test_both_numerator_and_denominator_are_corrected(runner, workspace, fake_claude):
    """AC3: spec 245's own real, archived staleness — a header of `73%
    (11 of 15 completed)` next to 19 real, all-✅ rows becomes `100% (19
    of 19 completed)`. Both numbers were wrong, not the denominator
    alone."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 20))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 73% (11 of 15 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "100% (19 of 19 completed)"

def test_a_fresh_status_file_with_no_rows_yet_is_left_untouched(runner, workspace, fake_claude):
    """AC4: a status file straight from the template — Phase tables with
    no rows yet, header still the literal `X` placeholder `/aide-create`
    writes — has nothing to derive from, so `create` leaves the line
    exactly as found."""
    made = "99-a-brand-new-spec"
    body = (
        "# New - Status\n\n"
        "Total progress: 0% (0 of X completed)\n\n"
        "## Tracking info\n\n"
        f"- **Task:** `{made}/`\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
    )
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'cat > "$specs/{made}/4-status.md" <<\'STATUSEOF\'\n'
        + body
        + "STATUSEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/4-status.md")
    assert "Total progress: 0% (0 of X completed)" in text

def test_the_bare_unbolded_format_survives_the_rewrite(runner, workspace, fake_claude):
    """AC5: real specs write `Total progress: X% (Y of Z completed)`
    directly under the title, unbolded, no bullet — not the documented
    bold/bulleted form. Only the digits change; the rest of the line and
    its position survive."""
    rows = "\n".join(f"| task {i} | ✅ | |" for i in range(1, 20))
    write_raw_status(
        workspace,
        "# Queue - Status\n\n"
        "Total progress: 73% (11 of 15 completed)\n"
        "Estimate: 4-6 hours (AI-assisted)\n\n"
        "## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        f"{rows}\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert "Total progress: 100% (19 of 19 completed)" in text
    assert "Estimate: 4-6 hours (AI-assisted)" in text

def test_the_bold_bulleted_format_survives_the_rewrite(runner, workspace, fake_claude):
    """AC6: the documented bold/bulleted form — `- **Total progress:**`
    inside `## Tracking info`, the exact shape `with_status()`'s own
    fixture writes — keeps its markup; only the digits change."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 4 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n**Status:** ✅ Completed\n\n### Tasks\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| one | ✅ | |\n"
        "| two | ✅ | |\n"
        "| three | ⬜ | |\n"
        "| four | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (2 of 4 completed)"

def test_a_non_checkbox_status_row_counts_as_one_task(runner, workspace, fake_claude):
    """AC7: a three-column row with a bare status word instead of a
    checkbox mark (spec 245's own real `Plan review` row) counts the
    same as any ordinary row."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 2 completed)\n\n---\n\n"
        "## Phase 1: RED\n\n"
        "| Task | Status | Notes |\n|------|--------|-------|\n"
        "| Plan review (feasibility, scope guardian, coherence) | ✅ | Three blind subagents; 2 must-fix |\n"
        "| ordinary task | ⬜ | |\n",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(text, "Total progress") == "50% (1 of 2 completed)"

@pytest.mark.parametrize(
    "case", STATUS_ROW_COUNTING, ids=[c["name"] for c in STATUS_ROW_COUNTING]
)
def test_the_shared_row_counting_fixture_matches_the_bash_side(
    runner, workspace, fake_claude, case
):
    """AC8, bash half: `tests/fixtures/status-row-counting.json` is the
    same table `dashboard/test/parse-status.test.ts` reads for the
    TypeScript half — both must report the identical done/total split
    for every case."""
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        f"- **Task:** `{workspace['folder']}/`\n"
        "- **Total progress:** 0% (0 of 999 completed)\n\n---\n\n"
        f"{case['body']}",
    )
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    if case["total"] == 0:
        assert bullet(text, "Total progress") == "0% (0 of 999 completed)"
    else:
        pct = (case["done"] * 100 + case["total"] // 2) // case["total"]
        assert bullet(text, "Total progress") == f"{pct}% ({case['done']} of {case['total']} completed)"

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
    assert "press Run again" in out["error"], out
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
