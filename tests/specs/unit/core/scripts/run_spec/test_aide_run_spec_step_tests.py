"""An implement that reported success ends on a green test run the
runner made itself (run-spec-step-tests.sh), never on the session's
word — the record on the branch is the runner's own.
"""

import json
from ..conftest import READ_SPECS, git, run
from .run_spec_results import CODEX_STREAM_OK, CODEX_THREAD_ID, RESULT_OK, emits
from .run_spec_status_files import with_status

BRANCH = "aide/81-queue-and-runner"


def _project_with_test_cmd(workspace, cmd):
    """The fixture's `.aide/config` reaches the step's worktree the same
    way a real project's does, so the command the runner resolves there
    is this one."""
    project = workspace["project"]
    config = project / ".aide" / "config"
    config.write_text(config.read_text().replace("AIDE_TEST_CMD=true", f"AIDE_TEST_CMD={cmd}"))


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
    when `fix_on_retry`, so the runner's next run is green."""
    fix = "printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n" if fix_on_retry else ":\n"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        f"  {fix}"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
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
    assert len(calls) == 2, calls
    assert "--resume" in calls[1] and "--session-id" not in calls[1], calls[1]
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
    assert len(calls) == 2, calls
    assert calls[1].startswith("exec resume ") and calls[1].endswith(f" {CODEX_THREAD_ID} -"), calls[1]
    assert "--json" in calls[1], calls[1]
    assert "--sandbox" not in calls[1] and "--add-dir" not in calls[1], calls[1]
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0, record


def test_a_suite_still_red_after_the_rounds_ends_tests_red(runner, workspace, fake_claude):
    """Two follow-up turns and no fix: the cap holds, the step ends
    tests-red, and the session was asked exactly 1 + 2 times."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "test -f fixed.txt")
    rc, out, _ = run(runner, workspace, _fixing_claude(fake_claude, fix_on_retry=False), command="implement")
    assert out["terminalReason"] == "tests-red", out
    assert len(fake_claude.calls.read_text().splitlines()) == 3


def test_a_step_with_no_budget_left_gets_no_follow_up_turn(runner, workspace, fake_claude):
    """The rounds live inside the step's own budget: a first turn that
    spent all of it ends tests-red at once, with no second turn."""
    with_status(workspace, ["create", "analyze"])
    _project_with_test_cmd(workspace, "false")
    spent = dict(RESULT_OK, total_cost_usd=3)
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"echo '{json.dumps(spent)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", budget_usd="3")
    assert out["terminalReason"] == "tests-red", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1


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


def test_an_archive_whose_merge_with_main_turns_the_suite_red_gets_it_back_and_fixes_it(
    runner, workspace, fake_claude
):
    """Main moved after implement's green run; the archive's pull merges
    it in and the suite is red on the merged result. The failing lines go
    back to the archive session, it fixes them, and the step ends
    completed with the runner's green record on the ARCHIVED folder."""
    with_status(workspace, ["create", "analyze", "implement"])
    _project_with_test_cmd(workspace, "test ! -f breaks.txt")
    _base_moved_under_the_branch(workspace)
    rc, out, _ = run(runner, workspace, _archiving_claude(fake_claude), command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "--resume" in calls[1], calls[1]
    record = json.loads(git(workspace["specs"], "show", f"{BRANCH}:archive/{workspace['folder']}/test-run.json"))
    assert record["exitCode"] == 0, record


def test_an_archive_still_red_after_the_rounds_ends_tests_red(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze", "implement"])
    _project_with_test_cmd(workspace, "test ! -f breaks.txt")
    _base_moved_under_the_branch(workspace)
    rc, out, _ = run(runner, workspace, _archiving_claude(fake_claude, fix_on_retry=False), command="archive")
    assert out["terminalReason"] == "tests-red" and out["ok"] is False, out
    assert len(fake_claude.calls.read_text().splitlines()) == 3


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
    suite.write_text(
        "#!/bin/sh\n"
        "echo 'queue: the checkout — Error: git is not on this machine'\n"
        "echo '(pass) a test that echoed that error and passed'\n"
        "echo '(fail) the one that really failed'\n"
        "exit 1\n"
    )
    suite.chmod(0o755)
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


# --- the session's own green record spares the runner's run ------------------


def _recording_claude(fake_claude, runner, record_cmd, after_record=""):
    """Implements, then records a run of `record_cmd` through the real
    aide-record-test-run (the runner's own sibling script), then commits.
    `after_record` runs after the record — a change that makes the
    delivered tree differ from the recorded one."""
    record = runner.parent / "aide-record-test-run"
    return fake_claude(
        "cat > /dev/null\n"
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
