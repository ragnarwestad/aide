"""aide-run-spec: the record of what has run: the status file, each phase's own tracking info, and reopening a spec.

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
from .conftest import READ_SPECS, git, run
from .run_spec_fakes import analyzing_claude, project_only_claude, specs_only_claude, writing_claude
from .run_spec_invoking import BRANCH, create
from .run_spec_origins import archive_the_spec, has_branch, make_branch
from .run_spec_results import CODEX_STREAM_FAILED, CODEX_STREAM_OK, CODEX_USAGE, FLAT_USAGE, RESULT_OK, emits
from .run_spec_status_files import TIME_OF_DAY_RE, TIME_SPENT_RE, already_ran, bullet, phase_file_text, recorded_line, recorded_model, reopen_line, reset_line, subject, tracking_block, with_analysis, with_analysis_attempts, with_solution, with_status

def test_a_copied_status_line_is_no_longer_corrected_by_the_step_that_runs(
    runner, workspace, fake_claude
):
    """Spec 153: four files copied from a sibling whose analyze had
    landed, so a folder minutes old claimed three steps. Nothing was
    committed for any of them, and the first real step used to write the
    claim back down to what history could prove.

    Spec 214 reverses that, deliberately: the two cases are the same
    case seen from opposite sides — a line naming a step no commit can
    corroborate is either a copied lie (153) or the only surviving
    record of a step that committed under its own subject (214). The
    scan cannot tell them apart, and 214's description settles which
    way to be wrong: "A step already named in the line is never removed,
    whatever the computation finds", with `aide-reopen` named as the one
    place a step comes off the line. A copied line therefore stands
    until someone edits the file or reopens the spec — the price of
    never erasing a step that really ran.
    """
    with_status(workspace, ["create", "analyze", "implement"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
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
    claude = project_only_claude(fake_claude, workspace)
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
                     timeout_sec="8", kill_grace_sec="2")
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
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Status" "" "## Tracking info" "" "- **Task:** \\`{made}/\\`" '
        + f'> "$specs/{made}/4-status.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81")
    assert rc == 0, out
    assert out["specFolder"] == made
    assert recorded_line(workspace, path=f"{made}/4-status.md") == "create"

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

def test_a_run_no_longer_writes_the_old_per_step_model_line(runner, workspace, fake_claude):
    """The centralized, scanned `Model (<step>):` line is gone: a fresh
    run writes this phase's own record into its own file (spec 245's
    tests above), never a `Model (<step>):` line into 4-status.md."""
    with_status(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    assert recorded_model(workspace, "analyze") is None

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

def test_a_create_run_records_its_own_outcome_and_no_repo_line(
    runner, workspace, fake_claude
):
    """AC1: `create` gains a time of day on `Created:`, and `Model` (when
    a model was named), `Result: completed` and `Time spent` — but no
    `Repo` line, since nothing was yet analyzed against."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/1-description.md")
    created = bullet(text, "Created")
    assert created and TIME_OF_DAY_RE.match(created), created
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    time_spent = bullet(text, "Time spent")
    assert time_spent and TIME_SPENT_RE.match(time_spent), time_spent
    assert bullet(text, "Repo") is None

def test_a_create_run_with_an_effort_records_it_beside_the_model(runner, workspace, fake_claude):
    """REQ-5: an `--effort` a run was given lands as its own bullet in the
    phase file's own Tracking info, beside `- **Model:**`."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5", effort="high")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/1-description.md")
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Effort") == "high"

def test_a_run_with_no_effort_writes_no_effort_line(runner, workspace, fake_claude):
    """REQ-4/REQ-5's second half: "absence over a guess" — a run given no
    `--effort` writes no `- **Effort:**` line at all, never an empty one."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Effort") is None

def test_a_re_run_replaces_a_stale_effort_line_rather_than_duplicating_it(
    runner, workspace, fake_claude
):
    """Mirrors the Model line's own re-run test: a second run at a
    different effort leaves exactly one `- **Effort:**` line, holding the
    newest run's value."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5", effort="low")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5", effort="max")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Effort:**") == 1, text
    assert bullet(text, "Effort") == "max"

def test_an_analyze_run_writes_one_repo_line_per_root(runner, workspace, fake_claude):
    """AC2: `Last analyzed:` gains a time of day, and the Tracking info
    gains one `Repo` line per repo root, each matching that root's own
    `head_before`."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    last_analyzed = bullet(text, "Last analyzed")
    assert last_analyzed and TIME_OF_DAY_RE.match(last_analyzed), last_analyzed
    repo_lines = [
        ln for ln in tracking_block(text).split("\n") if ln.startswith("- **Repo:**")
    ]
    assert len(repo_lines) == 2, repo_lines
    assert any(ln.startswith("- **Repo:** `proj/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert any(ln.startswith("- **Repo:** `specs/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"

def test_an_implement_run_stopped_by_timeout_records_the_stop(
    runner, workspace, fake_claude
):
    """AC3: a run stopped by its own time limit records that in
    `3-solution.md`'s `Result` line rather than `completed`."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (timeout)"), result_line

def test_a_failed_cli_run_records_a_sanitized_error_summary(
    runner, workspace, fake_claude
):
    """AC4: a CLI failure's `Result` line carries `stopped (cli-error)`
    followed by a one-line, backtick-free summary, truncated to at most
    200 characters — never the raw multi-line error verbatim."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    long_error = ("line one with a `backtick`\n" + "x" * 300)
    result = {**RESULT_OK, "is_error": True, "errors": [long_error]}
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "cli-error"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (cli-error)"), result_line
    assert "`" not in result_line, result_line
    assert "\n" not in result_line, result_line
    assert len(result_line) <= 200 + len("stopped (cli-error) — "), result_line

def test_an_archive_run_keeps_the_steps_line_and_adds_its_own_block(
    runner, workspace, fake_claude
):
    """AC5: `4-status.md` keeps the unchanged `Workflow steps completed:`
    line AND gains the new outcome block for `archive` itself — with no
    `Model (create|analyze|implement):` lines written by this run."""
    with_status(workspace, done=True)
    already_ran(workspace, ["create", "analyze", "implement"], write_line=True)
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"archive/{folder}/4-status.md")
    assert recorded_line(workspace, path=f"archive/{folder}/4-status.md") == "create, analyze, implement, archive"
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    assert bullet(text, "Time spent") is not None
    for step in ("create", "analyze", "implement"):
        assert f"Model ({step})" not in text, text

def test_a_re_run_of_the_same_step_replaces_the_block_not_duplicates_it(
    runner, workspace, fake_claude
):
    """AC6: running the same step twice leaves the phase file's block
    reflecting only the newest run — no duplicate lines, and the date
    field's time is overwritten rather than duplicated."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    # The second run leaves 2-analysis.md untouched — a re-run whose
    # file already carries the first run's block by the time THIS run's
    # own writer processes it, which is exactly the shape a real re-run
    # has (the file is not rewritten from scratch every time).
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Model:**") == 1, text
    assert text.count("- **Result:**") == 1, text
    assert text.count("- **Time spent:**") == 1, text
    assert text.count("- **Last analyzed:**") == 1, text
    assert bullet(text, "Model") == "claude claude-opus-5"

def test_a_result_bullet_outside_tracking_info_survives_the_write(
    runner, workspace, fake_claude
):
    """AC7: a `Result:`-shaped bullet the model wrote elsewhere in the
    same file (e.g. in prose about a past attempt) is not Tracking info,
    and the phase-outcome writer must not touch it."""
    with_status(workspace)
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" "" '
        + '"## Findings" "" "- **Result:** the earlier fix worked" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert "- **Result:** the earlier fix worked" in text, text
    # And Tracking info still gained its OWN Result line, alongside it.
    assert bullet(text, "Result") == "completed"

def test_a_codex_run_writes_a_tokens_line_with_no_cost_line(runner, workspace, fake_codex):
    """AC3: a Codex phase's own file gains a `Tokens:` bullet off the
    same `tokens_json` the result JSON already carries, with no `Cost:`
    line at all."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    u = CODEX_USAGE
    total = u["input_tokens"] + u["output_tokens"] + u["reasoning_output_tokens"] + u["cached_input_tokens"]
    assert bullet(text, "Tokens") == str(total)
    assert bullet(text, "Cost") is None

def test_a_run_with_no_usage_block_writes_no_tokens_line(runner, workspace, fake_codex):
    """AC4: a CLI that reported no usage block at all (a failed turn,
    here) leaves no `Tokens:` line — absence, not a `0`, mirroring how
    `Cost:` already behaves for an unmeasured figure."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    run(runner, workspace, tool="codex", codex=codex)
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Tokens") is None, text

def test_a_re_run_of_the_same_step_replaces_the_tokens_line_too(runner, workspace, fake_claude):
    """AC5: the same replace-not-duplicate guarantee AC6 above already
    gives Model/Result/Time spent/Cost extends to Tokens — the awk
    allowlist has to name it too, or a re-run would leave the first
    run's stale Tokens line in place alongside nothing new (`.match()`
    on the dashboard's read side returns the FIRST match, so a stale
    line would win over the fresh figure silently)."""
    with_status(workspace)
    result = {**RESULT_OK, "usage": FLAT_USAGE}
    folder = workspace["folder"]
    claude1 = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(result)}'"
    )
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert text.count("- **Tokens:**") == 1, text
    total = (
        FLAT_USAGE["input_tokens"] + FLAT_USAGE["output_tokens"]
        + FLAT_USAGE["cache_read_input_tokens"] + FLAT_USAGE["cache_creation_input_tokens"]
    )
    assert bullet(text, "Tokens") == str(total)

def test_a_fresh_phase_stamps_its_first_attempt(runner, workspace, fake_claude):
    """REQ-1: a phase with no prior `Attempts:` bullet at all gets `1` on
    its first run."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "1"

def test_a_re_run_increments_the_stamped_attempts_count(runner, workspace, fake_claude):
    """REQ-1, and the same replace-not-duplicate guarantee AC6 already
    gives Model/Result/Time spent: running the same step twice takes the
    bullet from 1 to 2, never duplicating the line."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Attempts:**") == 1, text
    assert bullet(text, "Attempts") == "2"

def test_a_run_continues_from_a_pre_existing_attempts_value(runner, workspace, fake_claude):
    """REQ-1: the write reads the file's CURRENT value rather than
    assuming the writer's own internal counter starts at 0 — a phase
    file seeded with `Attempts: 5` (e.g. from before this feature
    shipped) becomes `6` after one more run."""
    with_status(workspace)
    with_analysis_attempts(workspace, 5)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "6"

def test_reopen_finds_a_spec_that_is_already_in_the_archive(runner, workspace, fake_claude):
    """The --spec gate checks `$specs_root/$spec_arg` and `$specs_root/*/`
    and nothing else, so an archived folder is "unknown spec" — which
    would refuse the one step that exists to un-archive it, before the
    skill ever ran."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out

def test_the_archive_is_opened_for_reopen_and_for_no_other_step(
    runner, workspace, fake_claude
):
    """An archived spec is not runnable. `reopen` is the exemption, the
    way `create` is the exemption from "the folder must already exist" —
    a named step, never a general relaxation of the gate."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 2, out
    assert "unknown spec" in out["error"], out

def test_reopen_names_the_folder_not_its_archive_path(runner, workspace, fake_claude):
    """The branch, the worktree and the commit are named after the spec,
    and an archived folder resolving to `archive/<slug>` would name a
    branch `aide/archive/<slug>` — a different spec as far as every
    reader of the commit grammar is concerned."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", dry_run=True)
    assert rc == 0, out
    assert out["prompt"].startswith("/aide-reopen 81"), out["prompt"]

def test_reopen_takes_the_leftover_branch_out_of_both_roots(
    runner, workspace, fake_claude
):
    """Incident 1: a local ref left behind in the main checkout, and the
    next run refused to start on a conflict nobody could see. Both roots
    — an analyze step writes only in the specs repo, and its branch is
    just as much in the way."""
    archive_the_spec(workspace)
    old_project = make_branch(workspace["project"], BRANCH)
    old_specs = make_branch(workspace["specs"], BRANCH)
    # The step leaves work in both roots — in the ARCHIVED folder, which
    # is where a reopen finds the spec. Since spec 215 a branch carrying
    # nothing is deleted at the end of the run that cut it, so a step
    # committing nothing would leave no branch of the run's own to look
    # for here.
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "reopened" > "$PWD/new-code.txt"\n'
        + f'echo "reopened" > "$specs/archive/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    # The run cuts its own branch of the same name from the default
    # branch, so what has to be gone is the earlier round's TIP — not the
    # name.
    for root, old in ((workspace["project"], old_project), (workspace["specs"], old_specs)):
        assert has_branch(root, BRANCH), "the run's own branch"
        reachable = git(root, "rev-list", BRANCH)
        base = git(root, "rev-parse", f"{old}")
        assert base in reachable, "the default branch's history is still there"

def test_reopen_takes_the_branch_off_origin_in_both_roots(
    runner, workspace, fake_claude, origin
):
    """The other two of the four places a branch hides. `push` is `none`
    here, so nothing puts it back — what the bare repos hold at the end
    is what the deletion left."""
    archive_the_spec(workspace)
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), "staged: the branch is on origin"
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH), f"{bare} still holds {BRANCH}"

def test_reopen_succeeds_when_the_branches_are_already_gone(
    runner, workspace, fake_claude, origin
):
    """Every one of the four deletions tolerates "already gone": a spec
    whose branch was cleaned up by the landing that archived it is the
    normal case, not a failure."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out

def test_reopen_refuses_when_the_spec_is_already_active(runner, workspace, fake_claude):
    """The spec is left exactly where the resolver found it — active,
    not archived — so the run must refuse before it does anything else."""
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    assert "already active" in out["error"], out

def test_reopen_refusal_leaves_an_active_specs_branch_alone(
    runner, workspace, fake_claude, origin
):
    """The same four places incident 1 lost a branch in
    (test_reopen_takes_the_leftover_branch_out_of_both_roots and
    test_reopen_takes_the_branch_off_origin_in_both_roots) must survive a
    refused run untouched — proving the guard runs ahead of the
    branch-deletion block, not merely that the run exits nonzero."""
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    for root in (workspace["project"], workspace["specs"]):
        assert has_branch(root, BRANCH), f"{root} lost its local branch"
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), f"{bare} lost its branch"

def test_reset_accepts_an_active_spec_and_removes_remote_branches(
    runner, workspace, fake_claude, origin
):
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH)

def test_reset_is_refused_for_an_archived_spec(runner, workspace, fake_claude):
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 2, out
    assert "unknown spec" in out["error"]

def test_reopen_leaves_the_earlier_rounds_commits_in_the_repository(
    runner, workspace, fake_claude
):
    """The commits happened, and the archive is a record. What changes is
    what COUNTS them, never what is in the repository."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    archive_the_spec(workspace)
    before = git(workspace["specs"], "log", "--format=%s", "main")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    after = git(workspace["specs"], "log", "--format=%s", "main")
    assert before == after, "the default branch's history must not be rewritten"
    for step in ("create", "analyze", "implement", "archive"):
        assert subject(step, workspace["folder"]) in after

def test_the_reopen_boundary_takes_the_earlier_rounds_steps_off_the_line(
    runner, workspace, fake_claude
):
    """Incident 2: a reopened spec came back with the status file
    claiming four completed steps before anything had run."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"

def test_a_step_run_after_the_reopen_boundary_still_counts(
    runner, workspace, fake_claude
):
    """`--not <sha>` excludes what is REACHABLE from the mark, and a
    commit made after it is a descendant, never an ancestor. A boundary
    that hid the new round too would be the same bug pointing the other
    way."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    already_ran(workspace, ["create"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze"

def test_the_reset_boundary_excludes_the_earlier_round(runner, workspace, fake_claude):
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    status = workspace["specs"] / workspace["folder"] / "4-status.md"
    status.write_text(status.read_text().replace(reopen_line(boundary), reset_line(boundary)))
    git(workspace["specs"], "add", str(status))
    git(workspace["specs"], "commit", "-qm", "use reset boundary")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"

def test_a_spec_that_has_never_been_reopened_counts_everything(
    runner, workspace, fake_claude
):
    """The boundary is OPTIONAL everywhere it is added: a spec with no
    mark — the overwhelming majority — takes the path it took before."""
    already_ran(workspace, ["create", "implement"])
    with_status(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"
