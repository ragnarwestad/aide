"""An implement that reported success ends on a green test run the
runner made itself (run-spec-step-tests.sh), never on the session's
word — the record on the branch is the runner's own.
"""

import json
from ..conftest import git, run
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
