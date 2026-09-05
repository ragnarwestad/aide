"""aide-run-spec: what refuses a run before any AI is spent, and the steps that are not part of the ordinary four.

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
from .run_spec_fakes import creating_claude, project_only_claude, specs_only_claude, writing_claude
from .run_spec_invoking import BRANCH, CREATE_KEY, SCHEDULE_KEY, create, schedule, worktrees
from .run_spec_origins import is_ancestor, leave_branch_on_origin, leave_unmerged_branch_on_origin
from .run_spec_results import CODEX_STREAM_FAILED, CODEX_STREAM_OK, CODEX_THREAD_ID, CODEX_USAGE, RESULT_ERROR, RESULT_OK, emits
from .run_spec_status_files import add_spec, conflicting_branch, nested_workspace, set_depends_on, status_only_conflict, with_status

def test_refuses_implement_before_analyze_has_run(runner, workspace, fake_claude):
    with_status(workspace, claims=["create"])
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert out["errorReason"] == "not-analyzed-yet"
    assert workspace["folder"] in out["error"]
    assert "/aide-analyze" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
    assert not workspace["wtbase"].exists(), "and leave no worktree behind"

def test_implement_proceeds_once_analyze_is_on_the_line(runner, workspace, fake_claude):
    """Relies on the fixture's own default: `analyze` is already on the
    line, `implement`'s normal starting point since this spec."""
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

def test_analyze_is_unaffected_by_the_new_gate(runner, workspace, fake_claude):
    with_status(workspace, claims=[])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

def test_archive_keeps_its_own_gate(runner, workspace, fake_claude):
    """`analyze` on the line satisfies THIS gate, but archive's own
    not-implemented-yet check (spec 268) still asks about `implement`,
    which is not there — proving the new gate does not short-circuit or
    replace it."""
    with_status(workspace, claims=["analyze"])
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "not-implemented-yet", out
    assert not fake_claude.calls.exists()

def test_analyze_proceeds_despite_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

def test_create_proceeds_despite_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 2: what holds for analyze holds for create, the other
    step that only writes the spec's own folder."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

def test_create_proceeds_despite_an_unknown_or_self_dependency(
    runner, workspace, fake_claude, local_origins
):
    """The unknown and self cases are refusals for the gated steps only.
    A non-gated step never reaches the loop, so a typo is not its
    problem either — the step that acts on the dependency is where the
    refusal belongs."""
    set_depends_on(workspace, "77")  # nothing resolves to it
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

    set_depends_on(workspace, "81")  # the spec's own number
    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="create"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"

@pytest.mark.parametrize("command", ["archive"])
def test_the_other_gated_steps_still_refuse_an_unmerged_dependency(
    runner, workspace, fake_claude, local_origins, command
):
    """Criterion 3: implement is not the only gated step. archive moves
    the folder and lands the code — it builds on what has landed."""
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command=command)
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_archive_recovers_an_already_archived_spec_whose_branch_is_still_open(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 1. Pressing Archive again on an unlanded row must reach
    the skill, not refuse "unknown spec"."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")

    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert fake_claude.calls.exists(), "the step must have been invoked at all"

def test_archive_recovers_an_already_archived_spec_by_its_number(
    runner, workspace, fake_claude, local_origins
):
    """The fallback mirrors the resolver above it: a bare id resolves to
    <id>-* under archive/ exactly as it does among the active specs."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77")

    assert rc == 0, out
    assert out["terminalReason"] == "completed"

def test_archive_reports_an_already_landed_spec_as_done_not_refused(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 1. An archived spec with nothing left on origin is
    finished work, not a name that does not exist. It is reported as
    success, and it names the folder so a reader can act on it."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")

    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "already-landed", out
    assert "77-recovered" in out["note"], out
    assert not fake_claude.calls.exists(), "nothing to archive costs nothing"

def test_an_already_landed_spec_resolves_by_its_number_too(
    runner, workspace, fake_claude, local_origins
):
    """The graceful outcome follows the same resolver the refusal did: a
    bare id finds <id>-* under archive/, so pressing Archive on a
    finished row says so whichever address the caller used."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77")

    assert rc == 0, out
    assert out["terminalReason"] == "already-landed", out
    assert "77-recovered" in out["note"], out

def test_an_already_landed_spec_reports_the_same_outcome_to_the_result_file(
    runner, workspace, fake_claude, local_origins
):
    """The result file is what the dashboard reads, and it carries the
    same one JSON line stdout got — a caller never has to parse two
    shapes, refusal or not."""
    add_spec(workspace, "77-recovered", archived=True)
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command="archive", spec="77-recovered")
    result_file = workspace["project"].parent / "result.json"

    assert rc == 0, out
    assert json.loads(result_file.read_text()) == out

@pytest.mark.parametrize("step", ["analyze", "implement"])
def test_every_other_step_still_refuses_an_archived_spec_with_an_open_branch(
    runner, workspace, fake_claude, local_origins, step
):
    """Criterion 3. The fork is on the literal string `archive`: an
    archived spec is finished work for every other step, whatever its
    branch looks like."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")

    rc, out, _ = run(runner, workspace, claude, command=step, spec="77-recovered")

    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_create_does_not_resolve_an_archived_spec_with_an_open_branch(
    runner, workspace, fake_claude, local_origins
):
    """Criterion 3, for the one step that has no "unknown spec" refusal
    to give: `create` MAKES the folder, so a name it cannot resolve is
    its normal case. What it must not do is resolve the archived folder
    and archive-step its way past its own required arguments — so the
    proof is the missing-title refusal, which only happens when the
    folder stayed unresolved."""
    add_spec(workspace, "77-recovered", archived=True)
    leave_branch_on_origin(workspace, "aide/77-recovered")
    claude = fake_claude("exit 1")

    rc, out, _ = run(
        runner, workspace, claude, command="create", spec="77-recovered",
        description="Do the thing that was asked for",
    )

    assert rc == 2, out
    assert "title" in out["error"], out
    assert not fake_claude.calls.exists()

def test_workflow_steps_json_holds_the_known_lists(workspace_root):
    """REQ-1: one data file holds the workflow steps, the dependency-gated
    steps and the workflow arc — each matching today's known-good
    values."""
    path = workspace_root / "core" / "scripts" / "lib" / "workflow-steps.json"
    assert path.is_file(), f"the shared workflow-step file is missing: {path}"
    data = json.loads(path.read_text())
    assert data["workflowSteps"] == [
        "explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset", "schedule", "close",
    ]
    assert data["dependencyGatedSteps"] == ["implement", "archive"]
    assert data["workflowArc"] == ["create", "analyze", "implement", "archive"]
    assert data["workflowArcRetired"] == ["review-plan"]

def test_bash_no_longer_declares_the_step_lists_as_literals(workspace_root, run_spec_source):
    """REQ-2: the runner reads all four lists from workflow-steps.json now.
    WORKFLOW_STEPS keeps its old NAME (assigned from `$(jq ...)`, still a
    `NAME="..."` shape once computed), so this checks for the absence of
    the OLD LITERAL VALUE rather than the variable's name."""
    bash = run_spec_source
    for literal in (
        'WORKFLOW_STEPS="explore create analyze implement archive manifest reopen reset schedule"',
        'DEPENDENCY_GATED_STEPS="implement archive"',
        'WORKFLOW_ARC="create analyze implement archive"',
        'WORKFLOW_ARC_RETIRED="review-plan"',
    ):
        assert literal not in bash, f"aide-run-spec still declares {literal!r} as a literal"

def test_dashboard_no_longer_declares_the_step_lists_as_literals(workspace_root):
    """REQ-2: none of the three plain-import TypeScript files may keep a
    hand-written array literal once they import workflow-steps.json
    instead. `dashboard/src/queue/steps.ts` is excluded here — its
    `WorkflowStep` type is checked separately (REQ-4b), since a JSON
    import cannot give TypeScript a literal union."""
    config_ts = (workspace_root / "dashboard" / "src" / "serve" / "serve-helpers" / "config.ts").read_text()
    assert not re.search(r"export const DEPENDENCY_GATED_STEPS = \[.*?\] as const;", config_ts, re.S), (
        "config.ts still declares DEPENDENCY_GATED_STEPS as a literal array"
    )

    history_ts = (workspace_root / "dashboard" / "src" / "git" / "workflow-history.ts").read_text()
    assert not re.search(r"export const HISTORY_STEPS = \[.*?\];", history_ts, re.S), (
        "workflow-history.ts still declares HISTORY_STEPS as a literal array"
    )
    assert not re.search(r"export const HISTORY_STEPS_RETIRED = \[.*?\];", history_ts, re.S), (
        "workflow-history.ts still declares HISTORY_STEPS_RETIRED as a literal array"
    )

    parse_status_ts = (workspace_root / "dashboard" / "src" / "project" / "parse-status.ts").read_text()
    assert not re.search(r"const WORKFLOW_STEPS = \[.*?\];", parse_status_ts, re.S), (
        "parse-status.ts still declares WORKFLOW_STEPS as a literal array"
    )

def test_runner_refuses_by_name_when_one_of_its_own_parts_is_missing(runner, workspace, fake_claude, tmp_path):
    """The run's phases are files beside the script (split 2026-09-04).
    A missing one used to take `source` down with it under `set -e`: exit
    1, no JSON, and a caller reading the result file left with nothing to
    say. It refuses loudly instead, naming the file it could not find —
    and before the step runs, not at the line that sources it, which for a
    late phase would be after the money was spent."""
    lone_copy = tmp_path / "aide-run-spec-under-test"
    lone_copy.write_bytes(pathlib.Path(runner).read_bytes())
    lone_copy.chmod(0o755)
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    # Everything the script reads beside itself EXCEPT one phase, and a
    # late one: the refusal must not wait until the line that sources it.
    (tmp_path / "lib").mkdir(exist_ok=True)
    missing = "run-spec-publish.sh"
    for part in sorted((pathlib.Path(runner).parent / "lib").glob("*")):
        if part.is_file() and part.name != missing:
            (tmp_path / "lib" / part.name).write_bytes(part.read_bytes())
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, runner_path=lone_copy)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert missing in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"


def test_runner_refuses_when_the_workflow_steps_file_is_missing(runner, workspace, fake_claude, tmp_path):
    """REQ-3: a runner that cannot find the shared file refuses loudly,
    naming the file, rather than running with the four lists silently
    unset under `set -u`."""
    lone_copy = tmp_path / "aide-run-spec-under-test"
    lone_copy.write_bytes(pathlib.Path(runner).read_bytes())
    lone_copy.chmod(0o755)
    # The shared spec-resolution library lives beside the script too, and
    # its absence would fail the run for an unrelated reason first — give
    # the stand-in one, exactly as the self-copy tests above do, so the
    # only thing missing beside it is `lib/workflow-steps.json`.
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    # The run's own phases live beside the script too (split 2026-09-04)
    # and are refused for by name a few lines earlier — give the stand-in
    # those as well, so `lib/workflow-steps.json` is again the only thing
    # missing and this test still asks what it was written to ask.
    (tmp_path / "lib").mkdir(exist_ok=True)
    for part in sorted((pathlib.Path(runner).parent / "lib").glob("run-spec-*.sh")):
        (tmp_path / "lib" / part.name).write_bytes(part.read_bytes())
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, runner_path=lone_copy)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "workflow-steps.json" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_create_runs_for_a_spec_that_does_not_exist_yet(runner, workspace, fake_claude):
    """The whole refusal spec 87 hit: the spec-folder lookup is
    unconditional, so a spec that does not exist yet can never resolve
    and every `create` is refused before a worktree is even made."""
    claude = creating_claude(fake_claude)
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True, out
    # The tracking key names the branch and the worktree — and nothing
    # else. It is not, and must never become, a folder name.
    assert out["branch"] == f"aide/{CREATE_KEY}"
    assert fake_claude.branch_log.read_text().strip() == f"aide/{CREATE_KEY}"
    assert fake_claude.cwd_log.read_text().strip().startswith(str(workspace["wtbase"]))

def test_create_refuses_without_a_title(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, title=None)
    assert rc == 2
    assert out["ok"] is False
    assert "title" in out["error"], out
    assert not fake_claude.calls.exists()
