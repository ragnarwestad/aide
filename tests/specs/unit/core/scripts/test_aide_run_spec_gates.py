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
from .conftest import (
    BRANCH,
    CODEX_STREAM_FAILED,
    CODEX_STREAM_OK,
    CODEX_THREAD_ID,
    CODEX_USAGE,
    CREATE_KEY,
    READ_SPECS,
    RESULT_ERROR,
    RESULT_OK,
    SCHEDULE_KEY,
    add_spec,
    conflicting_branch,
    create,
    creating_claude,
    emits,
    git,
    is_ancestor,
    leave_branch_on_origin,
    leave_unmerged_branch_on_origin,
    nested_workspace,
    project_only_claude,
    run,
    schedule,
    set_depends_on,
    specs_only_claude,
    status_only_conflict,
    with_status,
    worktrees,
    writing_claude,
)

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
        "explore", "create", "analyze", "implement", "archive", "manifest", "reopen", "reset", "schedule",
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

def test_create_refuses_without_a_description(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, description=None)
    assert rc == 2
    assert out["ok"] is False
    assert "description" in out["error"], out
    assert not fake_claude.calls.exists()

def test_every_other_step_still_refuses_an_unknown_spec(runner, workspace, fake_claude):
    """The create path is an addition, never a widening: `analyze` on a
    spec that does not exist is still refused, with the same words."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec="no-such-spec")
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()

def test_create_asks_the_skill_for_a_spec_by_title_and_description(runner, workspace, fake_claude):
    """`/aide-create TODO-<name> <description>` is the skill's own
    documented argument shape (core/skills/aide-create/SKILL.md), so no
    parsing is invented on either side. The title is ALSO stated on a
    line of its own: the positional token is slugified, and a title is
    not something to recover from a slug."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        title="A new spec", description="Do the thing that was asked for",
        dry_run=True,
    )
    assert rc == 0, out
    prompt = out["prompt"]
    assert prompt.startswith("/aide-create TODO-a-new-spec Do the thing that was asked for"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt
    assert "headless" in prompt.lower()
    # The generic shape every other step uses would name a spec id this
    # spec does not have yet.
    assert f"/aide-create {CREATE_KEY}" not in prompt

def test_create_states_the_depends_on_value_the_form_chose(runner, workspace, fake_claude):
    """Spec 110: the `Depends on:` line has had a reader since spec 92 and
    no writer but a person at a shell. The value is STATED in the prompt,
    in the same voice as the title, for the same reason: it is a fact the
    skill is told, not a sub-format invented inside the argument string."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, depends_on="92,97-freshness", dry_run=True)
    assert rc == 0, out
    prompt = out["prompt"]
    assert "Use exactly this Depends-on value in Tracking info: 92,97-freshness" in prompt, prompt
    # Still the skill's own argument shape, and still the title beside it.
    assert prompt.startswith("/aide-create TODO-a-new-spec"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt

def test_create_without_the_flag_says_nothing_about_dependencies(runner, workspace, fake_claude):
    """Nothing chosen means no line — so the prompt must not mention the
    field at all, rather than state an empty one for the skill to write."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "Depends-on" not in out["prompt"], out["prompt"]

def test_create_reports_the_folder_the_step_actually_made(runner, workspace, fake_claude):
    """Read off the disk, never computed: the run diffs the specs root
    before and after, so the number and the slug stay the skill's
    business alone."""
    claude = creating_claude(fake_claude, ["94-a-new-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["specFolder"] == "94-a-new-spec", out
    # And the work is committed under the name the spec really has, not
    # under the throwaway key.
    branch_log = git(workspace["specs"], "log", "--oneline", f"aide/{CREATE_KEY}")
    assert "94-a-new-spec" in branch_log, branch_log

def test_create_reports_no_folder_when_two_appeared(runner, workspace, fake_claude):
    """Ambiguity is left unreported rather than guessed at: the spec
    still lands, and the job simply keeps its provisional key."""
    claude = creating_claude(fake_claude, ["94-a-new-spec", "95-another-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out

def test_create_reports_no_folder_when_none_appeared(runner, workspace, fake_claude):
    claude = creating_claude(fake_claude, [])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out

def test_schedule_runs_with_no_spec_folder_and_sends_the_file_verbatim(
    runner, workspace, fake_claude
):
    """AC4: `--command schedule --prompt-file <path>` with no folder for
    the tracking key under the specs root must not refuse with `unknown
    spec: ...`, and the prompt is the named file's own contents, not an
    aide slash command."""
    (workspace["project"] / "docs").mkdir()
    (workspace["project"] / "docs" / "nightly-report.md").write_text(
        "Summarize last night's traffic.\n"
    )
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = schedule(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "unknown spec" not in out.get("error", ""), out
    prompt = out["prompt"]
    assert prompt.startswith("Summarize last night's traffic."), prompt
    assert "headless" in prompt.lower()
    assert "/aide-" not in prompt, prompt

def test_schedule_requires_a_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file=None)
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()

def test_schedule_refuses_a_missing_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file="docs/does-not-exist.md")
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()

def test_every_other_step_still_refuses_the_schedule_tracking_key(runner, workspace, fake_claude):
    """The exemption is additive: `analyze` on a schedule-shaped key that
    names no real spec folder is refused exactly as any other unknown
    spec would be."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec=SCHEDULE_KEY)
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()

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
    assert "invalid --command" in out["error"], out
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
    assert "invalid --command" in out["error"], out
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_a_codex_run_records_tool_and_tokens_but_no_cost(runner, workspace, fake_codex):
    """Criterion 1. Codex reports tokens and NO dollar figure anywhere in
    its output, so `costUsd` is absent — not zero, and not Claude's
    over-charge-to-budget fallback, which has nothing to approximate
    from here."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    assert out["tool"] == "codex"
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert "costUsd" not in out, "a Codex step has no dollar figure to report"
    assert out["costMeasured"] is False
    # Codex's own thread id, read back the way Claude's session id is.
    assert out["sessionId"] == CODEX_THREAD_ID
    tokens = out["tokens"]
    u = CODEX_USAGE
    assert tokens["input"] == u["input_tokens"]
    # Codex bills reasoning tokens as output; both halves count.
    assert tokens["output"] == u["output_tokens"] + u["reasoning_output_tokens"]
    assert tokens["cacheRead"] == u["cached_input_tokens"]
    # Codex exposes no separate cache-WRITE count at all.
    assert tokens["cacheCreation"] == 0
    assert tokens["total"] == (
        u["input_tokens"] + u["output_tokens"] + u["reasoning_output_tokens"] + u["cached_input_tokens"]
    )

def test_a_claude_run_still_says_which_tool_ran_it(runner, workspace, fake_claude):
    """The field is on every result, not only Codex's: the dashboard
    reads it to pick a transcript parser, and "absent means claude" is a
    rule two readers would have to agree on separately."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["tool"] == "claude"
    # And the dollar figure is exactly what it always was.
    assert out["costUsd"] == pytest.approx(0.5357)

def test_bypass_permissions_becomes_codex_s_one_bypass_flag(runner, workspace, fake_codex):
    """Criterion 2. Codex's safety is TWO axes where Claude's is one
    string, and its single all-off flag replaces both — passing
    `--sandbox` beside it would be saying two things at once."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="bypassPermissions")
    assert rc == 0, out
    argv = fake_codex.calls.read_text()
    assert "--dangerously-bypass-approvals-and-sandbox" in argv
    assert "--sandbox" not in argv

def test_accept_edits_becomes_a_writable_workspace(runner, workspace, fake_codex):
    """Criterion 3. `codex exec` is non-interactive and has no
    `--ask-for-approval` flag at all (verified against codex-cli 0.147.0
    — that flag is the interactive command's); the sandbox mode is the
    whole of what it takes."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="acceptEdits")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert "--sandbox" in argv
    assert argv[argv.index("--sandbox") + 1] == "workspace-write"
    assert "--ask-for-approval" not in argv

def test_plan_mode_becomes_a_read_only_sandbox(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, permission_mode="plan")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert argv[argv.index("--sandbox") + 1] == "read-only"

def test_an_unrecognised_permission_mode_refuses_before_codex_starts(runner, workspace, fake_codex):
    """Criterion 4. The same "typed out or the run does not start"
    discipline `--permission-mode` already has for Claude: a mode with no
    entry in the table is refused rather than guessed at, because
    guessing wrong means a step running in the wrong sandbox."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     permission_mode="acceptEdit")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "acceptEdit" in out["error"]
    assert not fake_codex.calls.exists(), "the run must refuse before spawning anything"

def test_an_unknown_tool_is_refused(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, tool="gemini")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "gemini" in out["error"]

def test_an_unknown_effort_is_refused(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, effort="turbo")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "turbo" in out["error"]
    assert not fake_claude.calls.exists(), "the run must refuse before spawning anything"

def test_effort_lands_in_the_claude_argv(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, effort="high")
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    assert argv[argv.index("--effort") + 1] == "high"

def test_no_effort_flag_at_all_when_none_is_chosen(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    assert "--effort" not in argv

def test_effort_is_dropped_silently_for_a_codex_run(runner, workspace, fake_codex):
    """REQ-3: Codex has no `--effort` equivalent, and a chosen effort for
    a Codex-run phase is accepted and dropped, the same "ignored, not
    refused" treatment the script already gives Codex's other
    Claude-only knobs."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, effort="high")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert "--effort" not in argv

def test_a_codex_run_past_its_deadline_is_killed_the_same_way(runner, workspace, fake_codex):
    """Criterion 5. The timeout loop operates on a PID and a process
    group, never on a tool — so the only thing worth proving here is that
    a Codex step reaches it, and that a killed Codex step still reports
    no dollar figure (Claude's over-charge rule has nothing to work
    with)."""
    codex = fake_codex(
        "cat > /dev/null\n"
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     timeout_sec="8", kill_grace_sec="2")
    elapsed = time.time() - started
    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    assert out["tool"] == "codex"
    assert "costUsd" not in out
    assert out["costMeasured"] is False
    assert "tokens" not in out
    assert elapsed < 90, f"the kill took too long: {elapsed:.1f}s"

def test_a_failed_codex_turn_is_reported_not_swallowed(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert out["ok"] is False
    assert out["terminalReason"] == "cli-error"
    assert "refused the turn" in (out["error"] or "")

def test_a_codex_run_gets_no_session_id_argument(runner, workspace, fake_codex):
    """Every session id the dashboard hands down is freshly minted, so
    passing it to Codex would be asking it to resume a thread that has
    never existed. Codex assigns its own, and the run reads that back."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex,
                     session_id="11111111-2222-4333-8444-555555555555")
    assert rc == 0, out
    argv = fake_codex.calls.read_text()
    assert "--session-id" not in argv
    assert "resume" not in argv
    assert out["sessionId"] == CODEX_THREAD_ID

def test_a_codex_run_is_told_about_every_worktree_it_may_write_in(runner, workspace, fake_codex):
    """`--add-dir` is the same flag name on both CLIs (verified against
    codex-cli 0.147.0), so the one loop that hands over the sibling
    worktrees needs no branch — but nothing said so until this test."""
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    added = [argv[i + 1] for i, a in enumerate(argv) if a == "--add-dir"]
    assert added, "no --add-dir at all"
    assert any(a.endswith("/" + workspace["specs"].name) for a in added), added

def test_a_codex_run_is_started_with_exec_and_json(runner, workspace, fake_codex):
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, model="gpt-5.6")
    assert rc == 0, out
    argv = fake_codex.calls.read_text().split()
    assert argv[0] == "exec"
    assert "--json" in argv
    assert argv[argv.index("--model") + 1] == "gpt-5.6"
    # Claude's own flags have no meaning here and must not leak across.
    assert "--max-budget-usd" not in argv
    assert "--output-format" not in argv
    assert "--permission-mode" not in argv

def test_the_dry_run_shows_the_codex_argv(runner, workspace, fake_codex):
    codex = fake_codex("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, dry_run=True)
    assert rc == 0, out
    assert out["dryRun"] is True
    assert out["argv"][0] == str(codex)
    assert out["argv"][1] == "exec"
    assert not fake_codex.calls.exists()
