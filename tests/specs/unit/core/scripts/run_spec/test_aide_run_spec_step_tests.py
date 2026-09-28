"""An implement that reported success ends on a green test run the
runner made itself (run-spec-step-tests.sh), never on the session's
word — the record on the branch is the runner's own.
"""

import json
import re
import subprocess
from ..conftest import READ_SPECS, git, run, stand_in
from .run_spec_results import CODEX_STREAM_OK, CODEX_THREAD_ID, RESULT_OK, emits
from .run_spec_status_files import with_status

BRANCH = "aide/81-queue-and-runner"


def _project_with_test_cmd(workspace, cmd):
    """The fixture's `.aide/config` reaches the step's worktree the same
    way a real project's does, so the command the runner resolves there
    is this one."""
    project = workspace["project"]
    manifest = project / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", f"AIDE_TEST_CMD: {cmd}"))


def _implementing_claude(fake_claude):
    return fake_claude(
        "cat > /dev/null\n"
        "printf 'real work\\n' > implemented.txt\n"
        "git add -A && git commit -q -m 'the step'\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_implement_whose_tests_are_red_ends_tests_red_with_the_runners_own_record(
    runner, workspace, fake_claude
):
    """The session changed the project and said done; the project's test
    command fails on that result. The step ends `tests-red`, implement is
    not recorded as run, and the record on the branch — the runner's own —
    says exactly which command failed and how."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    rc, out, _ = run(runner, workspace, _implementing_claude(fake_claude), command="implement")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "tests-red", out
    assert "tests are red on its result" in out["error"], out["error"]
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] != 0 and record["command"] == "false", record
    status = git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/4-status.md")
    assert "implement" not in status.split("Workflow steps completed:**")[1].splitlines()[0]


def test_an_implement_whose_tests_are_green_carries_the_runners_record_on_the_branch(
    runner, workspace, fake_claude
):
    """Green: the step ends completed as before, and the record the branch
    carries is the runner's run of the resolved command, not whatever the
    session wrote."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "true")
    rc, out, _ = run(runner, workspace, _implementing_claude(fake_claude), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0 and record["command"] == "true", record


def _fixing_claude(fake_claude, fix_on_retry=True):
    """First turn: implements, leaving the tests red (fixed.txt missing).
    A follow-up turn — the prompt names the red suite — writes fixed.txt
    when `fix_on_retry`, so the runner's next run is green.

    The review turn in between takes the same "else" branch (its own
    prompt names no red suite either) — quieted with `|| true` so a
    second, no-op commit's own "nothing to commit" text does not land in
    the transcript."""
    fix = "printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n" if fix_on_retry else ":\n"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        f"  {fix}"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step' >/dev/null 2>&1 || true\n"
        "fi\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_a_red_suite_goes_back_to_the_session_and_a_fix_ends_the_step_completed(
    runner, workspace, fake_claude
):
    """The runner's own run is red, the failing lines go back to the SAME
    session as a follow-up turn (`--resume`), the session fixes it, and
    the runner's next run is green: the step ends completed, with the
    runner's green record on the branch."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, _fixing_claude(fake_claude), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    # implement, then the review (fresh — the fake's own prompt does not
    # say "test suite is red" either, so it takes the same "else" branch
    # and reports no defects), then the resumed fix turn.
    assert len(calls) == 3, calls
    assert "--resume" not in calls[1] and "--session-id" not in calls[1], calls[1]
    assert "--resume" in calls[2] and "--session-id" not in calls[2], calls[2]
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0, record


def _fixing_codex(fake_codex):
    """`_fixing_claude`'s twin for the second tool: the first turn leaves
    the tests red, the resumed turn — the prompt names the red suite —
    writes the fix. Emits Codex's own stream, thread id first."""
    return fake_codex(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        "fi\n"
        + emits(CODEX_STREAM_OK).replace("cat > /dev/null; ", "")
    )


def test_a_red_suite_goes_back_to_a_codex_thread_too(runner, workspace, fake_codex):
    """Codex gets the same follow-up turn as claude: `codex exec resume`
    on the thread its first turn named, the prompt on stdin, without the
    `--sandbox` and `--add-dir` pairs `resume` does not take."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, tool="codex", codex=_fixing_codex(fake_codex), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    calls = fake_codex.calls.read_text().splitlines()
    # implement, then the review (fresh — no "test suite is red" in its
    # own prompt either, so it takes the same "else" branch and reports
    # no defects), then the resumed fix turn.
    assert len(calls) == 3, calls
    assert "resume" not in calls[1], calls[1]
    assert calls[2].startswith("exec resume ") and calls[2].endswith(f" {CODEX_THREAD_ID} -"), calls[2]
    assert "--json" in calls[2], calls[2]
    assert "--sandbox" not in calls[2] and "--add-dir" not in calls[2], calls[2]
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0, record


def test_a_suite_still_red_after_the_rounds_ends_tests_red(runner, workspace, fake_claude):
    """Two follow-up turns and no fix: the cap holds, the step ends
    tests-red, and the session was asked exactly 1 (implement) + 1
    (review, which finds nothing to report here) + 2 (fix rounds)
    times."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, _fixing_claude(fake_claude, fix_on_retry=False), command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert len(fake_claude.calls.read_text().splitlines()) == 4



# --- archive: the merge with main is the step's own result too -----------------


def _base_moved_under_the_branch(workspace, filename="breaks.txt"):
    """The spec's branch exists with implement's work on it, and main has
    moved on since — a commit that adds `filename`. The archive step's
    pull merges that commit into the branch, which is where a suite green
    at implement time can turn red."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    (project / "implemented.txt").write_text("real work\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "the step")
    git(project, "switch", "-q", "main")
    (project / filename).write_text("main moved on\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "main side")


def _archiving_claude(fake_claude, fix_on_retry=True):
    """First turn: archives the folder. A follow-up turn — the prompt
    names the red suite — removes breaks.txt when `fix_on_retry`, so the
    runner's next run is green."""
    fix = "git rm -q breaks.txt && git commit -q -m 'the fix'\n" if fix_on_retry else ":\n"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        f"  {fix}"
        "else\n"
        + READ_SPECS
        + '  mkdir -p "$specs/archive" && git -C "$specs" mv 81-queue-and-runner archive/81-queue-and-runner '
        + '&& git -C "$specs" commit -q -m "archive"\n'
        "fi\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_an_archive_runs_no_suite_even_when_its_pull_merged_main(runner, workspace, fake_claude):
    """The landing runs the suite once, on exactly what main is about to
    become. A run here too was the same suite two and three times per
    archive — 498's archive took longer than its implement (2026-09-19)."""
    with_status(workspace, ["create", "analyze", "implement"])
    _project_with_test_cmd(workspace, "false")
    _base_moved_under_the_branch(workspace)
    rc, out, _ = run(runner, workspace, _archiving_claude(fake_claude), command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1


def test_an_archive_whose_base_did_not_move_runs_no_suite(runner, workspace, fake_claude):
    """Implement already ended on the runner's green run of this very
    tree; with nothing merged in, an archive has nothing new to test —
    a suite that would be red here is never run, and the step ends on
    its first turn."""
    with_status(workspace, ["create", "analyze", "implement"])
    _project_with_test_cmd(workspace, "false")
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    (project / "implemented.txt").write_text("real work\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "the step")
    git(project, "switch", "-q", "main")
    rc, out, _ = run(runner, workspace, _archiving_claude(fake_claude), command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1


def test_the_lines_handed_back_are_the_failures_not_every_line_with_error_in_it(
    runner, workspace, fake_claude, tmp_path
):
    """A suite prints "Error:" inside lines that belong to tests that
    PASS (a fake git's stderr echoed by a passing test, say). Those are
    not what failed, and a session handed them looks for a fault that is
    not there. Only the runner's own failure markers reach the prompt."""
    with_status(workspace, ["create", "analyze"])
    suite = tmp_path / "suite.sh"
    stand_in(
        suite,
        "#!/bin/sh\n"
        "echo 'queue: the checkout — Error: git is not on this machine'\n"
        "echo '(pass) a test that echoed that error and passed'\n"
        "echo '(fail) the one that really failed'\n"
        "exit 1\n"
    )
    _project_with_test_cmd(workspace, str(suite))
    seen = tmp_path / "prompt-seen.txt"
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"printf '%s' \"$prompt\" >> {seen}\n"
        "printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step' 2>/dev/null\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    prompt = seen.read_text()
    assert "(fail) the one that really failed" in prompt
    assert "git is not on this machine" not in prompt
    assert "(pass)" not in prompt


def test_the_fix_turn_asks_for_the_failing_tests_not_a_full_suite_until_green(
    runner, workspace, fake_claude, tmp_path
):
    """The runner runs the whole suite again after the turn. A session
    told to run it "until it is green" spent 486's archive and 491's
    implement on repeated full runs under load, and both hit their time
    limit with the change done (2026-09-18). The turn is asked for the
    failing tests and the ones covering the fix, one full run at most,
    and no rerun for a test that passes on its own."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    seen = tmp_path / "prompt-seen.txt"
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"printf '%s\\n----\\n' \"$prompt\" >> {seen}\n"
        "printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step' 2>/dev/null\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "tests-red", out
    # index 0: implement's own turn. index 1: the review, which reports
    # nothing here (this fake does not distinguish it). index 2: the
    # first real fix turn — the one whose own wording this test checks.
    fix_turn = seen.read_text().split("----")[2]
    assert "until it is green" not in fix_turn, fix_turn
    assert "the tests that failed" in fix_turn, fix_turn
    assert "at most once" in fix_turn, fix_turn
    assert "passes on its own" in fix_turn, fix_turn


# --- the session's own green record spares the runner's run ------------------


def _recording_claude(fake_claude, runner, record_cmd, after_record=""):
    """Implements, then records a run of `record_cmd` through the real
    aide-record-test-run (the runner's own sibling script), then commits.
    `after_record` runs after the record — a change that makes the
    delivered tree differ from the recorded one.

    The review turn that follows is matched by its own prompt and
    answered with nothing more than "no defects" — it must not run the
    record command a second time, which is exactly what a real review
    session's own "read and report only" instruction rules out."""
    record = runner.parent / "aide-record-test-run"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q \"Read this spec's own description\"; then\n"
        f"  echo '{json.dumps(RESULT_OK)}'\n"
        "  exit 0\n"
        "fi\n"
        "printf 'real work\\n' > implemented.txt\n"
        + 'specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'
        + f'"{record}" --project-dir . --specs-root "$specs" --folder 81-queue-and-runner --cmd "{record_cmd}" > /dev/null\n'
        + after_record
        + "git add -A && git commit -q -m 'the step'\n"
        + '(cd "$specs" && git add -A && git commit -q -m "the record")\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def _counting_cmd(tmp_path):
    marker = tmp_path / "runs.txt"
    return marker, f"echo run >> {marker}"


def test_a_green_record_for_the_delivered_tree_spares_the_runners_own_run(
    runner, workspace, fake_claude, tmp_path
):
    """The session ran the resolved command through aide-record-test-run
    on exactly the tree it delivered, and it was green: the runner
    accepts that record instead of running the same command again."""
    with_status(workspace, ["create", "analyze"])
    marker, cmd = _counting_cmd(tmp_path)
    _project_with_test_cmd(workspace, cmd)
    rc, out, _ = run(runner, workspace, _recording_claude(fake_claude, runner, cmd), command="implement")
    assert out["terminalReason"] == "completed", out
    assert marker.read_text().count("run") == 1, "the runner ran the suite again on an unchanged tree"


def test_a_record_for_an_older_tree_does_not_count(runner, workspace, fake_claude, tmp_path):
    """The session recorded a green run, then changed the project again:
    the delivered tree is not the recorded one, and the runner runs."""
    with_status(workspace, ["create", "analyze"])
    marker, cmd = _counting_cmd(tmp_path)
    _project_with_test_cmd(workspace, cmd)
    claude = _recording_claude(fake_claude, runner, cmd, after_record="printf 'more\\n' > later.txt\n")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert marker.read_text().count("run") == 2, "a record for another tree must not spare the runner's run"


def test_a_record_written_by_hand_does_not_count(runner, workspace, fake_claude, tmp_path):
    """A record that names no tree — written by the session itself rather
    than by aide-record-test-run — is the session's word, and the runner
    never takes that."""
    with_status(workspace, ["create", "analyze"])
    marker, cmd = _counting_cmd(tmp_path)
    _project_with_test_cmd(workspace, cmd)
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'real work\\n' > implemented.txt\n"
        + 'specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'
        + f'printf \'{{"command":"{cmd}","exitCode":0,"commit":"x","note":null}}\' > "$specs/81-queue-and-runner/test-run.json"\n'
        + "git add -A && git commit -q -m 'the step'\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert marker.exists() and marker.read_text().count("run") == 1, "the runner must run when the record carries no tree"


def test_a_green_record_after_a_fix_round_spares_the_runners_run_too(
    runner, workspace, fake_claude, tmp_path
):
    """The same question, asked after the session was handed red lines:
    it fixed them and ran the suite through aide-record-test-run until
    green, on exactly the tree it delivered. The runner's own run is
    red once, the session's is green once — and a third, the runner's
    check of a tree it has just seen recorded green, is not run (spec
    480's archive ran the suite four times, 2026-09-18)."""
    with_status(workspace, ["create", "analyze"])
    marker = tmp_path / "runs.txt"
    cmd = f"echo run >> {marker}; test -f fixed.txt"
    _project_with_test_cmd(workspace, cmd)
    record = runner.parent / "aide-record-test-run"
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        + 'specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'
        + "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        + "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        + f'  "{record}" --project-dir . --specs-root "$specs" --folder 81-queue-and-runner --cmd "{cmd}" > /dev/null\n'
        + "else\n"
        + "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        + "fi\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert marker.read_text().count("run") == 2, "the runner ran the suite again on a tree the session had just recorded green"


def test_a_green_step_reports_the_tree_and_commands_it_saw_green(runner, workspace, fake_claude, tmp_path):
    """What the landing needs to know it would test the same code: the
    tree the step saw green — hashed the way the landing will hash the
    branch it merges, links left out — and the commands it ran. A landing
    about to run the same commands on the same tree skips its own run."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "true")
    rc, out, _ = run(runner, workspace, _implementing_claude(fake_claude), command="implement")
    assert out["terminalReason"] == "completed", out
    assert out["testedGreen"]["commands"] == ["true"], out
    checkout = tmp_path / "the-branch"
    git(workspace["project"], "worktree", "add", "-q", "--detach", str(checkout), BRANCH)
    lib = runner.parent / "_aide-spec-lib.sh"
    # The links the main checkout names, handed over the way the landing
    # hands them: a fresh worktree carries no `.aide/project.yaml` to read
    # (it is untracked), so the value is read off the main checkout instead.
    hashed = subprocess.run(
        ["/bin/bash", "-c",
         'source "$1"; aide_tree_hash "$2" "$(aide_manifest_get worktreeLinks "$3")"',
         "_", str(lib), str(checkout), str(workspace["project"])],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    diff = git(workspace["project"], "diff-tree", "-r", "--name-status", out["testedGreen"]["tree"], hashed)
    assert out["testedGreen"]["tree"] == hashed, diff


def test_a_red_step_reports_nothing_seen_green(runner, workspace, fake_claude):
    """Red is not a tree anyone may skip testing: the field is absent."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    rc, out, _ = run(runner, workspace, _implementing_claude(fake_claude), command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert "testedGreen" not in out, out


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def test_the_second_turn_line_names_the_size_the_first_turn_left_AC_3(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    stream = tmp_path / "job.stream.jsonl"
    _, out, _, err = run(
        runner, workspace, _fixing_claude(fake_claude), command="implement",
        stream_file=str(stream), return_stderr=True,
    )
    turns = [s for s in _stamped(err) if s.startswith("model turn started")]
    # implement (byte 0), then the review (same reply, so the same
    # length), then the resumed fix turn.
    first = len(json.dumps(RESULT_OK)) + 1
    assert turns == [
        "model turn started (transcript at byte 0)",
        f"model turn started (transcript at byte {first})",
        f"model turn started (transcript at byte {first * 2})",
    ], turns


def test_a_green_run_is_a_line_after_the_line_that_says_the_tests_are_running_AC_3(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "true")
    _, out, _, err = run(runner, workspace, _implementing_claude(fake_claude), command="implement", return_stderr=True)
    stages = _stamped(err)
    running = next(i for i, s in enumerate(stages) if s.startswith("running the project's tests"))
    green = next(i for i, s in enumerate(stages) if s == "the project's tests are green")
    assert running < green, stages


def test_the_red_hand_back_and_a_tests_red_stop_are_error_lines_AC_7(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    _, out, _, err = run(
        runner, workspace, _fixing_claude(fake_claude, fix_on_retry=False), command="implement", return_stderr=True
    )
    errors = [s for s in _stamped(err) if s.startswith("error: ")]
    assert errors[0].startswith("error: the tests are red — handing them back"), errors
    assert errors[-1].startswith("error: the step reported success, but the project's tests are red"), errors
    assert "\n" not in errors[-1]


def test_the_runs_progress_is_in_the_log_between_start_and_end_and_its_output_beside_it(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, 'echo "===== 3 passed in 0.10s ====="')
    stream = tmp_path / "job.implement.stream.jsonl"
    _, out, _, err = run(
        runner, workspace, _implementing_claude(fake_claude), command="implement",
        stream_file=str(stream), return_stderr=True,
    )
    stages = _stamped(err)
    running = next(i for i, s in enumerate(stages) if s.startswith("running the project's tests"))
    green = next(i for i, s in enumerate(stages) if s == "the project's tests are green")
    progress = stages[running + 1:green]
    assert progress[0].startswith("tests: running echo"), stages
    assert "tests: pytest: 3 passed in 0.10s" in progress, stages
    assert "3 passed in 0.10s" in (tmp_path / "job.implement.tests.log").read_text()


def test_aides_own_parts_are_marked_started_and_done_around_the_ai_turn(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "true")
    _, out, _, err = run(runner, workspace, _implementing_claude(fake_claude), command="implement", return_stderr=True)
    stages = _stamped(err)
    marks = [s for s in stages if s.startswith("--- Step Aide: ") or s.startswith("model turn started")]
    assert marks[0] == "--- Step Aide: preparing — started", stages
    assert marks[1] == "--- Step Aide: preparing — done", stages
    assert marks[2].startswith("model turn started"), stages
    assert marks[3] == "--- Step Aide: tests and commit — started", stages
    assert marks[-1] == "--- Step Aide: tests and commit — done", stages
    # The runner's own test run is inside the part that is open.
    running = next(i for i, s in enumerate(stages) if s.startswith("running the project's tests"))
    assert stages.index(marks[3]) < running < len(stages) - 1 - stages[::-1].index(marks[-1]), stages


def test_a_red_step_ends_its_open_part_stopped_with_the_reason(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    _, out, _, err = run(runner, workspace, _implementing_claude(fake_claude), command="implement", return_stderr=True)
    assert out["terminalReason"] == "tests-red", out
    assert _stamped(err)[-1] == "--- Step Aide: tests and commit — stopped: tests-red", _stamped(err)


def test_an_implement_that_changed_only_markdown_runs_the_docs_check_not_the_suite(
    runner, workspace, fake_claude
):
    """A change to Markdown files alone cannot turn the suite red, and the
    whole suite for a changed paragraph was an hour of runs and fix turns
    (555, 556). The runner runs the project's documentation check."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    project = workspace["project"]
    (project / "scripts").mkdir()
    (project / "scripts" / "check-docs").write_text("#!/bin/sh\nexit 0\n")
    (project / "scripts" / "check-docs").chmod(0o755)
    git(project, "add", "scripts/check-docs")
    git(project, "commit", "-q", "-m", "docs check")
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'reworded\\n' > NOTES.md\n"
        "git add -A && git commit -q -m 'the step'\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0 and record["command"] == "scripts/check-docs", record


def test_the_runners_own_run_asks_for_four_workers(runner, workspace, fake_claude, tmp_path):
    """Two steps' suites at one worker per core each ran the git-backed
    tests out of time on load alone."""
    with_status(workspace, ["create", "analyze"])
    seen = tmp_path / "workers.txt"
    _project_with_test_cmd(workspace, f'echo "$AIDE_TEST_WORKERS $PYTEST_XDIST_AUTO_NUM_WORKERS" > {seen}')
    rc, out, _ = run(runner, workspace, _implementing_claude(fake_claude), command="implement")
    assert out["terminalReason"] == "completed", out
    assert seen.read_text().strip() == "4 4"
