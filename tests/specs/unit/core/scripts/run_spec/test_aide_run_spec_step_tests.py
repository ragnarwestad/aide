"""An implement that reported success ends on a green test run the
runner made itself (run-spec-step-tests.sh), never on the session's
word — the record on the branch is the runner's own.
"""

import json
from ..conftest import READ_SPECS, git, run
from .run_spec_results import RESULT_OK
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
