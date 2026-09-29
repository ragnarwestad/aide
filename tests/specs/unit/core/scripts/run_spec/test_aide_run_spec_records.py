"""aide-run-spec: the record of what has run: the status file, each phase's own tracking info, and reopening a spec.

One part of a suite that was one 7348-line file until 2026-09-04;
the tests are unchanged and keep their names. What they share sits
in conftest.py beside them.
"""

import json
import os
import re
import signal
import subprocess
from ..conftest import READ_SPECS, STOP_DEADLINE_SEC, git, run
from .run_spec_invoking import CREATE_KEY, create, wait_until
from .run_spec_fakes import project_only_claude, specs_only_claude, writing_claude
from .run_spec_results import RESULT_OK
from .run_spec_status_files import (
    acceptance_cells,
    acceptance_section,
    already_ran,
    branch_file,
    bullet,
    phase_file_text,
    recorded_line,
    recorded_model,
    section_of,
    state_of,
    status_on_branch_or_main,
    status_on_main,
    subject,
    with_acceptance,
    with_status,
)

def test_a_copied_status_line_is_no_longer_corrected_by_the_step_that_runs(
    runner, workspace, fake_claude
):
    """A line naming a step no commit can corroborate is either a copied
    lie (four files copied from a sibling whose analyze had landed) or the
    only surviving record of a step that committed under its own subject.
    The scan cannot tell them apart, so a step already named on the line
    stays named when a step runs, and only `aide-reopen` or a completed
    analysis takes one off. A copied line therefore stands until someone
    edits the file, reopens the spec or analyzes it again.
    """
    with_status(workspace, ["create", "analyze", "implement"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_the_line_names_every_step_the_history_has(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    # Workflow order, not log order, and this run's own step included.
    assert recorded_line(workspace) == "create, analyze, implement"

def test_a_step_that_touches_only_the_project_still_gets_a_specs_commit(
    runner, workspace, fake_claude
):
    """Spec 206: `implement` changes code and nothing under the specs
    root, so the commit loop there has nothing of the step's own to
    commit. The line rewrite is what gives it something — without it
    the step leaves no trace in either the file or the history, which
    is how a finished implement came to be missing from the line.

    The stopped-step half of this is
    `test_a_step_that_was_stopped_is_not_written_as_completed`; this is
    the same proof for a step that COMPLETES.
    """
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"
    branch_log = git(
        workspace["specs"], "log", "--format=%s", "aide/81-queue-and-runner"
    ).split("\n")
    assert subject("implement", model="claude") in branch_log, branch_log

def test_a_step_that_was_stopped_is_not_written_as_completed(runner, workspace, fake_claude):
    """Spec 147, from the other side: the step ran and did not finish.
    The commit says so — the line, which is about what COMPLETED, does
    not gain it."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    import subprocess as sp

    claude = fake_claude(
        "cat > /dev/null\n"
        # Half-written in both roots: the specs change is what the
        # runner commits under "(stopped: timeout)" — since spec 344's
        # fixture already carries the steps line, nothing else in the
        # specs repo would change on a stopped implement.
        + READ_SPECS
        + f'echo "half-written" > "$specs/{workspace["folder"]}/3-solution.md"\n'
        + 'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     timeout_sec=STOP_DEADLINE_SEC, kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert recorded_line(workspace) == "create, analyze"
    # And the stop is on the record that DOES carry it.
    assert "stopped: timeout" in git(
        workspace["specs"], "log", "-1", "--pretty=%s", "aide/81-queue-and-runner"
    )

def test_a_completed_run_supersedes_the_stop_before_it(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    already_ran(workspace, ["implement"], stopped="timeout")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_an_interactive_commit_without_the_headless_marker_counts(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"], headless=False)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_a_historical_review_plan_commit_still_counts_as_completed(
    runner, workspace, fake_claude
):
    """Criterion 2, bash side, and description requirement 2 ("every
    archived spec whose history contains a review-plan run still
    displays that history"). `review-plan` folded into `analyze` (spec
    181) and is no longer a step a NEW run may claim (WORKFLOW_STEPS
    refuses it) or write as its own arc stage (WORKFLOW_ARC no longer
    names it) — but an commit made before this change is still on disk,
    and it must still be recognized: `WORKFLOW_ARC_RETIRED` is what
    keeps `completed_steps_for` counting it.

    Plan review labelled this a characterization test on the theory
    that Phase 2 "never touches the commit-subject regex" — that framing
    missed that WORKFLOW_ARC is also a FILTER on old commits, not just
    a list of what a new run may write, and dropping review-plan from it
    with nothing else changed made this go genuinely red (confirmed
    empirically before WORKFLOW_ARC_RETIRED was added). It is a real RED
    test, not a characterization one."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "review-plan"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    # Current arc order first, then retired steps: WORKFLOW_ARC_RETIRED
    # is not woven back into its old position, only kept from vanishing.
    assert recorded_line(workspace) == "create, analyze, implement, review-plan"

def test_a_commit_for_another_spec_is_not_this_spec_history(runner, workspace, fake_claude):
    with_status(workspace)
    for step in ["create", "analyze", "implement"]:
        subprocess.run(
            ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
             "-m", subject(step, "99-somebody-else")],
            check=True,
        )
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"

def test_the_line_is_written_into_the_steps_own_commit(runner, workspace, fake_claude):
    """Not an amend: the line lands in a SECOND commit of its own (spec
    343), made only once the step's own content is confirmed on origin —
    never folded into the step's own commit, and never rewriting it."""
    with_status(workspace)
    before = git(workspace["specs"], "rev-parse", "main")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    commits = git(workspace["specs"], "log", "--format=%s", f"{before}..{branch}").split("\n")
    # The model suffix (spec 217) is part of the subject a headless run
    # writes: the tool is always known, so it is always there. Two
    # commits sharing the same subject: pass 1 (the step's own content)
    # and pass 2 (the line, once pass 1 is confirmed on origin).
    assert commits == [subject("analyze", model="claude")] * 2, commits
    assert recorded_line(workspace) == "analyze"

def test_an_archive_run_finds_the_status_file_it_just_moved(runner, workspace, fake_claude):
    """The mechanical pre-check (spec 251, core/scripts/aide-archive-spec)
    does the `git mv` of the whole folder into `archive/` before the
    runner's commit loop, or the model, ever runs — so the path the line
    has to be written at is not the one the run started with."""
    with_status(workspace, done=True)
    already_ran(workspace, ["create", "analyze", "implement"], write_line=True)
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert (
        recorded_line(workspace, path=f"archive/{folder}/4-status.md")
        == "create, analyze, implement, archive"
    )

def test_a_spec_with_no_status_file_is_not_a_failure(runner, workspace, fake_claude):
    """Deletes the fixture's default status file to get back to the
    no-status-file scenario every other test in this file used to run
    with, before spec 344 gave the fixture a default. Nothing to write
    is nothing to do."""
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.unlink()
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "remove status"], check=True)
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert not out.get("error"), out["error"]

def test_a_create_run_writes_the_line_into_the_folder_it_just_made(
    runner, workspace, fake_claude
):
    """`create` is the one step whose spec folder is not the one the run
    was started with — the commit names what it made, and so does the
    file it writes into."""
    made = CREATE_KEY
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** \\`{made}/\\`" '
        + f'> "$specs/{made}/4-status.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["specFolder"] == made
    assert recorded_line(workspace, branch=f"aide/{CREATE_KEY}", path=f"{made}/4-status.md") == "create"

def test_a_step_outside_the_workflow_arc_leaves_the_line_alone(
    runner, workspace, fake_claude
):
    """`explore` is not a stage a spec passes through, and it writes
    nothing today. It must not start leaving a commit — and with it a
    branch no step lands — for a line it has no news about."""
    with_status(workspace, ["create", "analyze", "implement"])
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="explore")
    assert rc == 0, out
    assert git(workspace["specs"], "log", "-1", "--pretty=%s", "main") == "add status"
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["specs"])]["changedFiles"] == 0

def test_a_line_that_is_already_right_is_not_rewritten(runner, workspace, fake_claude):
    """The commit loop commits whatever it finds changed. A file
    rewritten to exactly what it already said would put a step's name on
    a commit carrying nothing."""
    # Spec 217: the Model line is part of "already right" now — a file
    # missing it has news to gain, and gaining it is a real change.
    with_status(workspace, ["create", "analyze"], models={"analyze": "claude"})
    already_ran(workspace, ["create", "analyze"])
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    # spec 355: this fixture has never had a 4-status.json before, so
    # this run's own state-file derivation writes one for the first
    # time — the ONE genuinely new file. The prose itself carries no
    # news, exactly as this test's own name says.
    assert roots[str(workspace["specs"])]["changedFiles"] == 1

def test_the_state_file_names_the_step_the_run_just_added(runner, workspace, fake_claude):
    """A completed step lands in the prose line AND in 4-status.json. The
    state file keeps its own list of completed phases rather than
    re-deriving it from prose, so the runner has to hand it the list it
    just wrote — otherwise a file that already existed before the run
    (from create, from a backfill) goes on saying what it said, and the
    next implement is held back as not analyzed (2026-09-02, spec 361)."""
    with_status(workspace, ["create"])
    already_ran(workspace, ["create"])
    state = workspace["specs"] / workspace["folder"] / "4-status.json"
    state.write_text(json.dumps({"completedPhases": ["create"], "archived": None,
                                 "reopened": None, "acceptanceCriteria": [], "phaseCounts": {}}))
    subprocess.run(["git", "-C", str(workspace["specs"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["specs"]), "commit", "-qm", "state file"], check=True)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    prose = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert bullet(prose, "Workflow steps completed") == "create, analyze"
    written = json.loads(phase_file_text(workspace, f"{workspace['folder']}/4-status.json"))
    assert written["completedPhases"] == ["create", "analyze"]

def test_a_historical_model_line_survives_untouched(runner, workspace, fake_claude):
    """Risk analysis (3-solution.md, spec 245): specs archived before
    this change still carry the old, centralized `Model (<step>):` lines
    — left exactly as they are, not migrated, when a later step's own
    write touches the rest of the file."""
    with_status(workspace, ["create"], models={"create": "claude claude-opus-5"})
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert recorded_model(workspace, "create") == "claude claude-opus-5"

def test_a_completed_analysis_takes_implement_off_the_line_and_the_state_AC_1(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze", "implement"])
    already_ran(workspace, ["create", "analyze", "implement"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze"
    assert state_of(workspace)["completedPhases"] == ["create", "analyze"]

def _specs_changed(out, workspace):
    return {r["root"]: r for r in out["repos"]}[str(workspace["specs"])]["changedFiles"]

def test_a_step_that_ends_after_the_analysis_does_not_bring_implement_back_AC_1(
    runner, workspace, fake_claude
):
    """The analysis reset the line to `create, analyze`. A later run that
    stops finds the earlier implement commit in the log, and used to write
    `implement` onto the line again; the run's commit for the line carries
    nothing when the analysis is newer than that commit."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "implement", "analyze"])
    claude = project_only_claude(fake_claude)  # an analyze that touches the code: scope-violation
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "scope-violation", out
    assert _specs_changed(out, workspace) == 0

def test_an_implement_that_completes_after_the_analysis_names_implement_again_AC_2(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "implement", "analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_an_implement_that_ends_without_completing_leaves_the_reset_line_alone_AC_2(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "implement", "analyze"])
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "no-progress", out
    assert _specs_changed(out, workspace) == 0

def test_an_analysis_on_a_spec_that_never_implemented_changes_nothing_about_implement_AC_4(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze"
    assert state_of(workspace)["completedPhases"] == ["create", "analyze"]

def test_an_analysis_that_ends_without_completing_leaves_implement_on_the_line_AC_5(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze", "implement"])
    already_ran(workspace, ["create", "analyze", "implement"])
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "scope-violation", out
    assert _specs_changed(out, workspace) == 0

def test_a_stopped_analysis_above_an_implement_does_not_take_it_off_AC_5(
    runner, workspace, fake_claude
):
    """Both scans, not the line: the line here names no `implement`, so
    only the commit above an analyze that stopped can bring it back."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze", "implement"])
    already_ran(workspace, ["analyze"], stopped="timeout")
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "scope-violation", out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_an_analysis_made_on_top_of_an_implement_with_an_earlier_date_still_wins_AC_1(
    runner, workspace, fake_claude
):
    """The log's default order can list a commit before one made on top of
    it: the implement is dated later than the analysis above it, and a
    second ref points at it. `--date-order` never does."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create"])

    def commit_dated(step, date):
        env = {**os.environ, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
        subprocess.run(
            ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
             "-m", subject(step, workspace["folder"])],
            check=True, env=env,
        )

    commit_dated("implement", "2026-09-10T12:00:00")
    git(workspace["specs"], "branch", "second-ref-at-the-implement")
    commit_dated("analyze", "2026-09-01T12:00:00")
    claude = project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "scope-violation", out
    assert _specs_changed(out, workspace) == 0

def test_the_two_copies_of_the_commit_subject_grammar_agree(workspace_root, run_spec_source):
    """Risk 1, and AC7's structural half. The grammar exists once in
    bash (`completed_steps_for`) and once in TypeScript
    (`subjectPattern`), with no shared source, and BOTH anchor on `$`.
    Adding a trailing group to one and not the other would stop every
    future subject matching in the language that was missed — breaking
    the pre-existing "Workflow steps completed" derivation, not just the
    model line. The fifth hand-paired pair in this repo, pinned the way
    the other four already are.
    """
    import re

    bash = run_spec_source
    m = re.search(r'^\s*re="(\^Run /aide-[^"]*)"', bash, re.M)
    assert m, "aide-run-spec no longer builds the subject regex as a plain string"
    from_bash = m.group(1).replace("${folder}", "FOLDER")

    ts = (workspace_root / "dashboard" / "src" / "git" / "workflow-history.ts").read_text()
    m = re.search(r"const subjectPattern[^;]*?new RegExp\(\s*(.*?),?\s*\);", ts, re.S)
    assert m, "workflow-history.ts no longer builds the subject regex from template literals"
    from_ts = "".join(re.findall(r"`([^`]*)`", m.group(1)))
    from_ts = (
        from_ts.replace("${escapeRegExp(specFolder)}", "FOLDER")
        # A JS string literal doubles every backslash the regex needs;
        # bash's `[[ =~ ]]` operand does not. And the only structural
        # difference the two are allowed is capture-vs-not.
        .replace("\\\\", "\\")
        .replace("(?:", "(")
    )

    assert from_bash == from_ts, (
        "the script and the dashboard disagree about the commit-subject grammar:\n"
        f"  bash: {from_bash}\n"
        f"  ts:   {from_ts}"
    )

def test_a_step_only_the_line_knows_about_survives_a_later_recompute(
    runner, workspace, fake_claude
):
    """Acceptance criterion 1, and the Woodstack 22 shape exactly: a
    MULTI-step line, one of whose steps has no commit matching the
    subject grammar anywhere in history, recomputed by a later step."""
    with_status(workspace, ["analyze", "implement"], done=True)
    already_ran(workspace, ["analyze"])  # implement committed under its own subject
    subprocess.run(
        ["git", "-C", str(workspace["specs"]), "commit", "-q", "--allow-empty",
         "-m", f"Record the implementation of {workspace['folder']}"],
        check=True,
    )
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    # Workflow order, not the order the two sources found them in.
    assert recorded_line(workspace, path=f"archive/{folder}/4-status.md") == "analyze, implement, archive"

def test_a_step_both_sources_find_is_named_once(runner, workspace, fake_claude):
    """Acceptance criterion 2. The line and the commit scan overlap for
    every step that ran headlessly — the union must not double them."""
    with_status(workspace, ["create", "analyze"])
    already_ran(workspace, ["create", "analyze"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"

def test_a_line_naming_something_that_is_not_a_step_drops_it(
    runner, workspace, fake_claude
):
    """The union filters through `WORKFLOW_ARC`/`WORKFLOW_ARC_RETIRED`
    exactly as the commit scan does, so a placeholder or a typo left on
    the line by hand does not become permanent."""
    with_status(workspace, ["analyze", "not-a-step"])
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze, implement"


# --- a new analysis of an implemented spec clears the acceptance ticks ------

BRANCH = "aide/81-queue-and-runner"
STEPS = ["create", "analyze", "implement"]
NOTE = "Not tested: needs a deploy; check the log"


def _implemented_with_acceptance(workspace, rows, criteria, section=None, done=False):
    with_status(workspace, STEPS, done=done)
    with_acceptance(workspace, section or acceptance_section(rows), criteria)
    already_ran(workspace, STEPS)


def _statuses(text):
    return [status for _, status, _ in acceptance_cells(text)]


def test_a_completed_analysis_unticks_every_acceptance_row_and_the_state_AC_1(
    runner, workspace, fake_claude
):
    _implemented_with_acceptance(
        workspace,
        ["| AC-1: first | ✅ | |", "| AC-2: second | Not verified | |", "| AC-3: third | ⬜ | |"],
        {1: "first", 2: "second", 3: "third"},
    )
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    assert _statuses(branch_file(workspace["specs"], "4-status.md", workspace)) == ["⬜", "⬜", "⬜"]
    criteria = state_of(workspace)["acceptanceCriteria"]
    assert len(criteria) == 3
    assert all(not c["done"] and "notVerified" not in c for c in criteria), criteria

def test_a_completed_analysis_leaves_the_phase_rows_alone_AC_1(runner, workspace, fake_claude):
    _implemented_with_acceptance(
        workspace, ["| AC-1: first | ✅ | |"], {1: "first"}, done=True
    )
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    after = branch_file(workspace["specs"], "4-status.md", workspace)
    assert "| already done | ✅ | |" in section_of(after, "## Phase 1")
    assert section_of(after, "## Phase 1") == section_of(status_on_main(workspace), "## Phase 1")

def test_a_section_without_a_table_is_left_as_it_is_AC_1(runner, workspace, fake_claude):
    sentence = "\n## Acceptance criteria\n\nAcceptance ticking was not required for this run.\n"
    _implemented_with_acceptance(workspace, None, {1: "first"}, section=sentence)
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    after = branch_file(workspace["specs"], "4-status.md", workspace)
    assert section_of(after, "## Acceptance") == section_of(status_on_main(workspace), "## Acceptance")

def test_the_tick_list_takes_the_descriptions_wording_after_the_analysis_AC_2(
    runner, workspace, fake_claude
):
    _implemented_with_acceptance(
        workspace,
        [
            "| AC-1: The old wording | ✅ | Read as: the list page |",
            "| AC-2: A removed criterion | Not verified | |",
            f"| AC-3: Unchanged | ✅ | {NOTE} |",
        ],
        {1: "The new wording", 3: "Unchanged", 4: "A new criterion"},
    )
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    assert acceptance_cells(branch_file(workspace["specs"], "4-status.md", workspace)) == [
        ("AC-1: The new wording", "⬜", ""),
        ("AC-3: Unchanged", "⬜", NOTE),
        ("AC-4: A new criterion", "⬜", ""),
    ]
    assert [c["task"] for c in state_of(workspace)["acceptanceCriteria"]] == [
        "AC-1: The new wording", "AC-3: Unchanged", "AC-4: A new criterion",
    ]

def test_a_description_without_criterion_lines_keeps_the_rows_and_clears_the_ticks_AC_3(
    runner, workspace, fake_claude
):
    _implemented_with_acceptance(
        workspace, ["| AC-1: first | ✅ | a note |", "| AC-2: second | Not verified | |"], {}
    )
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    assert acceptance_cells(branch_file(workspace["specs"], "4-status.md", workspace)) == [
        ("AC-1: first", "⬜", "a note"),
        ("AC-2: second", "⬜", ""),
    ]

def test_archive_stops_for_the_criteria_a_new_analysis_cleared_AC_3(runner, workspace, fake_claude):
    _implemented_with_acceptance(
        workspace,
        ["| AC-1: first | ✅ | |", "| AC-2: second | Not verified | |"],
        {1: "first", 2: "second"},
    )
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    specs = workspace["specs"]
    git(specs, "merge", "-q", "--ff-only", BRANCH)
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), command="implement")
    assert rc == 0, out
    git(specs, "merge", "-q", "--ff-only", BRANCH)
    rc, out, _ = run(runner, workspace, fake_claude("cat > /dev/null\n"), command="archive")
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    assert (specs / workspace["folder"]).exists()
    assert not (specs / "archive" / workspace["folder"]).exists()

def test_an_analysis_of_a_spec_never_implemented_keeps_its_ticks_AC_4(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    with_acceptance(
        workspace,
        acceptance_section(["| AC-1: old wording | ✅ | |", "| AC-2: second | Not verified | |"]),
        {1: "new wording", 2: "second"},
    )
    already_ran(workspace, ["create", "analyze"])
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), command="analyze")
    assert rc == 0, out
    assert _statuses(branch_file(workspace["specs"], "4-status.md", workspace)) == ["✅", "Not verified"]
    first, second = state_of(workspace)["acceptanceCriteria"]
    assert first["done"] and "notVerified" not in first
    assert second.get("notVerified") is True

def test_an_analysis_the_scope_check_stopped_keeps_the_ticks_AC_5(runner, workspace, fake_claude):
    _implemented_with_acceptance(
        workspace, ["| AC-1: first | ✅ | |", "| AC-2: second | Not verified | |"], {1: "first", 2: "second"}
    )
    rc, out, _ = run(runner, workspace, project_only_claude(fake_claude), command="analyze")
    assert out["terminalReason"] == "scope-violation", out
    assert section_of(status_on_branch_or_main(workspace), "## Acceptance") == section_of(
        status_on_main(workspace), "## Acceptance"
    )

def test_a_cancelled_analysis_keeps_the_ticks_AC_5(runner, workspace, fake_claude, tmp_path):
    _implemented_with_acceptance(
        workspace, ["| AC-1: first | ✅ | |", "| AC-2: second | Not verified | |"], {1: "first", 2: "second"}
    )
    ready = tmp_path / "ready"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"touch {ready}\n"
        + "sleep 60\n"
    )
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
            "--command", "analyze",
            "--spec", workspace["folder"],
            "--timeout-sec", "120",
            "--permission-mode", "acceptEdits",
            "--result-file", str(tmp_path / "result.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env={**os.environ, "AIDE_CLAUDE_BIN": str(claude)},
    )
    try:
        wait_until(ready.exists, 60, "the step never started writing")
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert branch_file(workspace["specs"], "2-analysis.md", workspace) == "analysis"
    assert section_of(branch_file(workspace["specs"], "4-status.md", workspace), "## Acceptance") == section_of(
        status_on_main(workspace), "## Acceptance"
    )
