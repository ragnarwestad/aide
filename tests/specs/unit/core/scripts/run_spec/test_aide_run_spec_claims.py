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
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import analyze_claude_advancing_row, analyze_claude_naming_implement, analyze_claude_renaming_the_header, analyze_claude_writing_the_line_from_nothing, project_only_claude, specs_foreign_folder_claude, specs_only_claude, writing_claude
from .run_spec_invoking import create
from .run_spec_origins import run_with_gh
from .run_spec_project_state import BASH_ERROR_REGISTRY, CODE_LANDING, configure_code_landing
from .run_spec_results import RESULT_OK
from .run_spec_status_files import STATUS_ROW_COUNTING, bullet, conflicting_branch, phase_file_text, recorded_line, status_with_phase, with_status, write_raw_status

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
