"""aide-run-spec: how the run is invoked and what comes back: the binary it picks, the dry run, the refusals, the result, the tokens beside the dollars, and the graceful stop.

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
from ..conftest import git, run
from .run_spec_fakes import writing_claude
from .run_spec_invoking import _standalone_runner_copy
from .run_spec_results import FLAT_USAGE, MODEL_USAGE, RESULT_BUDGET, RESULT_OK, emits

def test_the_claude_binary_can_be_named_in_the_projects_own_config(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # dry run: must not be called
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + f"AIDE_CLAUDE_BIN={claude}\n")
    env_before = os.environ.pop("AIDE_CLAUDE_BIN", None)
    try:
        rc, out, _ = run(runner, workspace, dry_run=True)
    finally:
        if env_before is not None:
            os.environ["AIDE_CLAUDE_BIN"] = env_before
    assert rc == 0, out
    assert out["argv"][0] == str(claude)
    assert not fake_claude.calls.exists()

def test_the_environment_outranks_the_projects_config_for_the_claude_binary(runner, workspace, fake_claude):
    from_env = fake_claude("exit 1")
    cfg = workspace["project"] / ".aide" / "config"
    cfg.write_text(cfg.read_text() + "AIDE_CLAUDE_BIN=/nowhere/from-config\n")
    rc, out, _ = run(runner, workspace, from_env, dry_run=True)
    assert rc == 0, out
    assert out["argv"][0] == str(from_env)

def test_dry_run_prints_the_argv_it_would_use_and_spawns_nothing(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(
        runner, workspace, claude,
        command="implement", budget_usd="3", timeout_sec="1200",
        permission_mode="bypassPermissions", dry_run=True,
    )
    assert rc == 0
    argv = out["argv"]
    assert argv[0] == str(claude), "the claude path must be resolved, never a bare name"
    assert "-p" in argv
    # stream-json is the only format that emits anything DURING the run,
    # and print mode refuses it without --verbose (probed against the
    # real CLI 2026-08-16, version 2.1.233).
    assert argv[argv.index("--output-format") + 1] == "stream-json"
    assert "--verbose" in argv
    assert argv[argv.index("--max-budget-usd") + 1] == "3"
    assert argv[argv.index("--permission-mode") + 1] == "bypassPermissions"
    # The spec ID is the folder's numeric prefix, and the prompt SAYS the
    # run is headless rather than leaving it in the environment.
    assert out["prompt"].startswith("/aide-implement 81")
    assert "headless" in out["prompt"].lower()
    assert not fake_claude.calls.exists(), "a dry run must not invoke claude"

def test_the_prompt_itself_says_nobody_can_answer(runner, workspace, fake_claude):
    """AIDE_HEADLESS in the environment was not enough: a skill has to
    remember to go and read it, and on 2026-08-17 an archive run read
    ABOUT the variable while analysing spec 88 and never checked its own.
    It then stopped to ask a question nobody could answer, and reported
    success. A fact the model must act on belongs in the text it is
    given, not in a place it has to think to look."""
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = run(runner, workspace, claude, dry_run=True)
    assert rc == 0
    prompt = out["prompt"]
    assert prompt.startswith("/aide-analyze 81"), prompt
    lowered = prompt.lower()
    assert "headless" in lowered
    # And it must say what follows from it, not merely name the state.
    assert "no one" in lowered or "nobody" in lowered

def test_the_prompt_says_never_to_wait_on_background_work(runner, workspace, fake_claude):
    """Four implement runs on 2026-09-02 ended their turn with "the
    tests are running in the background, I'll pick up when they
    finish" — and nothing ever picked up, because a headless run ends
    the moment the model stops. The prompt has to say so, in the text
    the model is reading, not in a rule it has to remember."""
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = run(runner, workspace, claude, dry_run=True, command="implement")
    assert rc == 0
    lowered = out["prompt"].lower()
    assert "background" in lowered
    assert "foreground" in lowered
    assert "end your turn" in lowered

def test_a_dirty_project_tree_does_not_stop_the_run(runner, workspace, fake_claude, command="implement"):
    """Spec 144. The run works in a worktree cut from origin's default
    branch, so nothing in the main checkout reaches it — dirty or not.
    A stray file used to refuse every job touching the repo, however
    unrelated it was to the spec being run."""
    (workspace["project"] / "scratch.txt").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    # And the stray file is left exactly as it was: never staged,
    # committed, or removed.
    assert (workspace["project"] / "scratch.txt").read_text() == "uncommitted\n"
    assert git(workspace["project"], "status", "--porcelain") == "?? scratch.txt"
    branch = "aide/81-queue-and-runner"
    assert "scratch.txt" not in git(workspace["project"], "show", "--name-only", "--pretty=", branch)

def test_a_dirty_specs_root_does_not_stop_the_run(runner, workspace, fake_claude, command="implement"):
    """The specs repo is where /aide-analyze actually writes, so it was
    the root the old refusal guarded hardest. Its worktree is cut from
    origin's default branch too (spec 144)."""
    (workspace["specs"] / "stray.md").write_text("uncommitted\n")
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert not out.get("error"), out["error"]
    assert (workspace["specs"] / "stray.md").read_text() == "uncommitted\n"
    assert git(workspace["specs"], "status", "--porcelain") == "?? stray.md"

@pytest.mark.parametrize(
    "kwargs,fragment",
    [
        ({"budget_usd": None}, "budget"),
        ({"permission_mode": None}, "permission"),
        ({"timeout_sec": None}, "timeout"),
        ({"result_file": None}, "result-file"),
        ({"command": "review"}, "command"),
        ({"spec": "99-nope"}, "spec"),
    ],
)
def test_refuses_bad_arguments(runner, workspace, fake_claude, kwargs, fragment):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, **kwargs)
    assert rc == 2, out
    assert out["ok"] is False
    assert fragment in out["error"].lower()
    # Spec 153: a refusal with nothing a machine can act on says nothing
    # — the key is absent, not null and not empty. Same rule as
    # `specFolder` and `tokens`.
    assert "errorReason" not in out
    assert not fake_claude.calls.exists()

def test_refuses_a_directory_that_is_not_a_git_repo(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude("exit 1")
    plain = tmp_path / "plain"
    plain.mkdir()
    rc, out, _ = run(runner, {**workspace, "project": plain}, claude)
    assert rc == 2
    assert "git" in out["error"].lower()

def test_a_successful_run_carries_cost_session_and_subtype(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, err = run(runner, workspace, claude)
    assert rc == 0, err[-1500:]
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert out["subtype"] == "success"
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert out["costUsd"] == pytest.approx(0.5357)
    assert out["costMeasured"] is True
    roots = {r["root"]: r for r in out["repos"]}
    assert str(workspace["project"]) in roots
    assert str(workspace["specs"]) in roots

def test_a_successful_run_records_the_tokens_every_model_used(runner, workspace, fake_claude):
    result = {**RESULT_OK, "modelUsage": MODEL_USAGE, "usage": FLAT_USAGE}
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    tokens = out["tokens"]
    # Summed across models, not taken from the first one.
    assert tokens["input"] == 100
    assert tokens["output"] == 61_000
    assert tokens["cacheRead"] == 4_498_000
    assert tokens["cacheCreation"] == 384_000
    # Every token the call actually processed, cached or not: that is
    # what a subscription plan meters.
    assert tokens["total"] == 100 + 61_000 + 4_498_000 + 384_000
    # And the cost is untouched beside it — this adds a figure, it does
    # not replace one.
    assert out["costUsd"] == pytest.approx(0.5357)

def test_a_result_with_only_a_flat_usage_block_still_records_tokens(runner, workspace, fake_claude):
    """`modelUsage` first, the flat `usage` second. An implementation
    that reads only the per-model block would leave this run with no
    figure at all, so the fallback needs its own case: the priority
    order is invisible to every other test here."""
    result = {**RESULT_OK, "usage": FLAT_USAGE}
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    tokens = out["tokens"]
    assert tokens["input"] == 54
    assert tokens["output"] == 22_054
    assert tokens["cacheRead"] == 3_177_754
    assert tokens["cacheCreation"] == 107_458
    assert tokens["total"] == 54 + 22_054 + 3_177_754 + 107_458

def test_a_result_with_no_usage_at_all_records_no_tokens(runner, workspace, fake_claude):
    """ABSENT, not zero. A zero would be read as "this step used
    nothing", and the dashboard shows a dash for a field that is not
    there — the same contract a missing cost already has."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert "tokens" not in out

def test_the_run_happens_inside_the_project_not_the_callers_directory(runner, workspace, fake_claude):
    """A skill resolves the project from its working directory. The
    first real job ran with the server's cwd and analysed the wrong
    repository — it cost $0.45 to find out, so it gets a test.

    Since spec 91 the directory is the project's WORKTREE rather than its
    main checkout (criterion 2), but the property is the same one: the
    step must stand in the tree the run will commit from.
    """
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    cwd = fake_claude.cwd_log.read_text().strip()
    assert cwd != str(workspace["project"].resolve()), "the step must not stand in the main checkout"
    assert cwd.startswith(str(workspace["wtbase"])), cwd
    assert fake_claude.branch_log.read_text().strip() == "aide/81-queue-and-runner"
    assert fake_claude.toplevel_log.read_text().strip() == cwd, "and it is a checkout of its own"

def test_the_child_process_always_gets_aide_headless(runner, workspace, fake_claude):
    """This runner is the only caller that runs a workflow step with
    nobody there to answer. A skill cannot tell that from inside, so the
    runner states it: three archive jobs stopped on a confirmation
    question, reported `done` and moved nothing."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert "AIDE_HEADLESS=1" in fake_claude.env_log.read_text().splitlines()

def test_survives_its_own_file_being_replaced_mid_run(runner, workspace, fake_claude, tmp_path):
    """An aide `implement` step reinstalls aide, which copies this very
    script over itself. Bash reads a script incrementally from disk, so
    without a private copy the runner dies mid-job — measured on the
    first end-to-end run, eight minutes in, after the work had already
    succeeded."""
    copy = _standalone_runner_copy(runner, tmp_path)
    # The fake claude overwrites the running script, exactly as the
    # installer would.
    claude = fake_claude(
        "cat > /dev/null\n"
        f'printf "#!/bin/bash\\necho REPLACED\\n" > {copy}\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", "the run must finish even though its file was replaced"
    assert copy.read_text().startswith("#!/bin/bash"), "the replacement really happened"

def test_a_stale_self_copy_marker_never_deletes_the_installed_script(runner, workspace, fake_claude, tmp_path):
    """The private copy unlinks itself, and it recognises itself by an
    environment variable. That variable is inherited by everything the
    step spawns — including `claude` — so a nested run (a test, a
    terminal inside the run, the next job) would think the INSTALLED
    script was the throwaway copy and delete it. Measured 2026-08-16:
    one test run removed core/scripts/aide-run-spec from the worktree.
    """
    copy = _standalone_runner_copy(runner, tmp_path)
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    env_marker = str(tmp_path / "some-other-path")
    old = os.environ.get("AIDE_RUN_SPEC_SELF_COPY")
    os.environ["AIDE_RUN_SPEC_SELF_COPY"] = env_marker
    try:
        rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    finally:
        if old is None:
            os.environ.pop("AIDE_RUN_SPEC_SELF_COPY", None)
        else:
            os.environ["AIDE_RUN_SPEC_SELF_COPY"] = old
    assert rc == 0, out
    assert copy.exists(), "the script the caller pointed at must survive its own run"

def test_the_self_copy_marker_does_not_reach_the_step(runner, workspace, fake_claude, tmp_path):
    """Belt and braces for the same bug: the marker must not be in the
    environment claude runs in, or anything that step starts inherits
    it."""
    seen = tmp_path / "marker-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        f'printf "%s\\n" "${{AIDE_RUN_SPEC_SELF_COPY:-none}}" > {seen}\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert seen.read_text().strip() == "none"

def test_a_run_starts_from_the_default_branch_not_the_last_job_s(runner, workspace, fake_claude):
    """The previous job leaves its spec branch checked out. Starting
    there would base new work on stale code — and if that branch was
    merged and deleted upstream, the pull fails outright, which is how
    this was found.

    Restated for spec 91: the step no longer runs in the main checkout at
    all, so what is asserted is the branch the WORKTREE was cut from. The
    main checkout's own branch is criterion 1's business.
    """
    stale = "aide/99-previous-job"
    subprocess.run(["git", "-C", str(workspace["project"]), "switch", "-q", "-c", stale], check=True)
    (workspace["project"] / "leftover.txt").write_text("from the last job\n")
    subprocess.run(["git", "-C", str(workspace["project"]), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(workspace["project"]), "commit", "-qm", "old work"], check=True)

    saw = workspace["project"].parent / "saw-leftover.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        f'test -f "$PWD/leftover.txt" && echo yes > {saw}\n'
        f'echo "written by the step" > "$PWD/new-code.txt"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    # The worktree came off main, so the previous job's file is absent.
    assert not saw.exists(), "the step must not see the previous job's work"
    # And the main checkout is on the default branch, so the NEXT job
    # does not inherit this one either.
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert stale in git(workspace["project"], "branch", "--list", stale)

def test_budget_exhausted_is_stopped_not_a_generic_failure(runner, workspace, fake_claude):
    """A cap-stop is a common, healthy outcome under tight caps. It must
    be distinguishable from an agent that broke."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget"
    assert out["subtype"] == "error_max_budget_usd"
    assert out["costUsd"] == pytest.approx(0.2030)
    assert out["costMeasured"] is True

def test_the_result_file_is_written_as_well_as_stdout(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    result_file = workspace["project"].parent / "result.json"
    rc, out, _ = run(runner, workspace, claude, result_file=result_file)
    assert result_file.exists(), "a detached child has no pipe home: the file IS the contract"
    assert json.loads(result_file.read_text())["sessionId"] == out["sessionId"]

def test_work_is_committed_on_a_branch_in_both_roots(runner, workspace, fake_claude):
    claude = writing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    branch = "aide/81-queue-and-runner"
    # The work is ON the branch; the main checkout never left main.
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(workspace["specs"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert "analyze" in git(workspace["project"], "log", "-1", "--pretty=%s", branch)
    # The specs repo is branched too, and handed back on main — the
    # analysis lives on the branch, not on main.
    assert "analyze" in git(workspace["specs"], "log", "-1", "--pretty=%s", branch)
    assert "analyze" not in git(workspace["specs"], "log", "-1", "--pretty=%s", "main")
    # Both roots clean afterwards: a run commits its own work on the
    # branch and leaves nothing behind in the main checkouts, so a later
    # reader of either tree sees only what was there before.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert git(workspace["specs"], "status", "--porcelain") == ""
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["project"])]["changedFiles"] == 1
    assert roots[str(workspace["specs"])]["changedFiles"] == 1

def test_a_run_past_its_deadline_is_killed_and_reported_as_stopped(runner, workspace, fake_claude):
    claude = fake_claude(
        "cat > /dev/null\n"
        'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="2")
    elapsed = time.time() - started

    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    # A SIGKILLed claude prints nothing, so the cost cannot be measured.
    # The accounting must over-charge what it could not measure.
    assert out["costUsd"] == pytest.approx(3.0)
    assert out["costMeasured"] is False
    # And no token figure at all. A cost may be assumed — that is the
    # over-charge rule — but a token count may not: there is nothing to
    # assume it from, so the field stays away rather than saying zero.
    assert "tokens" not in out
    assert elapsed < 90, f"the kill took too long: {elapsed:.1f}s"

    result_file = workspace["project"].parent / "result.json"
    assert result_file.exists(), "a stop must always leave a result file"
    assert json.loads(result_file.read_text())["terminalReason"] == "timeout"

    # Whatever the step managed to write is committed, with the reason,
    # so the tree is clean for the next run.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert "stopped: timeout" in git(
        workspace["project"], "log", "-1", "--pretty=%s%n%b", "aide/81-queue-and-runner"
    )

    # Spec 152: the sentence a reader actually sees. A stop at OUR OWN
    # limit is not an outside fault, and the work is not lost — the
    # commit asserted two lines above is exactly what makes that true.
    # `error` is read verbatim by the row's panel and the job page's
    # banner, so this string is the whole of what either one says.
    assert "time limit" in out["error"]
    assert "8s" in out["error"], "the limit's own number belongs in the sentence"
    assert "committed" in out["error"]
    assert "killed" not in out["error"], "a limit we set is not something that happened to us"

def test_a_stopped_run_is_charged_its_budget_even_when_it_flushes_json(runner, workspace, fake_claude):
    """Measured on the mini 2026-08-16: a SIGTERM'd `claude -p` DOES
    flush its result JSON — but with subtype error_during_execution and
    total_cost_usd 0. Trusting that number would under-charge exactly
    the runs that ran longest, so a stop is charged its full budget
    whether or not a result was written."""
    flushed = {
        "type": "result", "subtype": "error_during_execution",
        "is_error": True, "session_id": "abc", "total_cost_usd": 0,
        # Spec 118: a flushed result carries a usage block too, and it
        # is no more trustworthy than the $0 beside it.
        "modelUsage": MODEL_USAGE,
    }
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo {json.dumps(json.dumps(flushed))}; exit 143' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="5")
    assert out["terminalReason"] == "timeout"
    assert out["costUsd"] == pytest.approx(3.0), "the flushed $0 must not be believed"
    assert out["costMeasured"] is False
    assert "tokens" not in out, "a stopped run's flushed usage is no more measured than its cost"

def test_a_child_that_exits_on_sigterm_is_never_sigkilled(runner, workspace, fake_claude, tmp_path):
    marker = tmp_path / "term-seen"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo yes > {marker}; exit 0' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="30")
    elapsed = time.time() - started
    assert marker.exists(), "SIGTERM must reach the child"
    assert elapsed < 30, "the run should end when the child exits, not wait out the whole grace"
    assert out["terminalReason"] == "timeout"

# --- spec 386: a run may say acceptance ticking is not required ------------
#
# The value has to be STATED to the skill, not just handed to the harness
# binary as a CLI flag: `/aide-analyze`'s own Step 8 reasoning has no way
# to see an argv entry passed to the `claude`/`codex` process that hosts
# it. Modelled on `depends_line` (spec 110), the one existing case of a
# per-run value turned into a sentence appended to a skill's prompt.

def test_analyze_states_the_switch_was_chosen(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = run(
        runner, workspace, claude, command="analyze", acceptance_not_required=True, dry_run=True,
    )
    assert rc == 0, out
    prompt = out["prompt"]
    assert prompt.startswith("/aide-analyze"), prompt
    assert (
        "Acceptance ticking is not required for this run: per Step 8, do not "
        "write the acceptance-criteria table into 4-status.md — write the "
        "one-line note instead." in prompt
    ), prompt

def test_analyze_without_the_flag_says_nothing_about_acceptance(runner, workspace, fake_claude):
    """REQ-3: nothing chosen means no line — the prompt must not mention
    the switch at all, exactly the byte-for-byte rule `depends_line`
    already follows."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", dry_run=True)
    assert rc == 0, out
    assert "Acceptance ticking" not in out["prompt"], out["prompt"]

def test_the_flag_is_read_for_analyze_alone(runner, workspace, fake_claude):
    """The flag is passed on every step's own invocation of a job (like
    `--depends-on`), but only the `analyze` branch of the prompt may
    ever read it — a future step growing its own use for it is a risk
    this test is the tripwire for."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(
        runner, workspace, claude, command="implement", acceptance_not_required=True, dry_run=True,
    )
    assert rc == 0, out
    assert "Acceptance ticking" not in out["prompt"], out["prompt"]
