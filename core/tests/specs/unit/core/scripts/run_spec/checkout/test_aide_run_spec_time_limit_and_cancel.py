"""A step's time limit counts the AI's turns, not the runner's own test
runs, which have a limit of their own per run; and Cancel keeps what the
step wrote.
"""

import json
import os
import signal
import subprocess
import time
from ...conftest import git, run
from ..run_spec_invoking import wait_until
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import conflicting_branch, with_status
from ..run_spec_result_fields import assert_written_as_in_fixture

BRANCH = "aide/81-queue-and-runner"


def _test_cmd(workspace, cmd):
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", f"AIDE_TEST_CMD: {cmd}"))


def test_the_runners_own_test_run_stops_at_its_own_limit(runner, workspace, fake_claude, monkeypatch):
    with_status(workspace, ["create", "analyze"])
    _test_cmd(workspace, "sleep 120")
    monkeypatch.setenv("AIDE_TEST_RUN_LIMIT_SEC", "6")
    claude = fake_claude("cat > /dev/null\nprintf 'real work\\n' > implemented.txt\n" f"echo '{json.dumps(RESULT_OK)}'")
    began = time.monotonic()
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert time.monotonic() - began < 60, "the suite ran on past its own limit"
    assert out["terminalReason"] == "timeout", out
    assert out["error"] is None and "errorSolution" not in out, out
    assert_written_as_in_fixture("timeLimit", out["timeLimit"])
    assert out["timeLimit"] == {"seconds": 6, "during": "tests"}
    # The work is on the branch, for the next press to test.
    assert git(workspace["project"], "show", f"{BRANCH}:implemented.txt") == "real work"


def test_the_steps_time_limit_leaves_out_the_runners_own_test_runs(runner, workspace, fake_claude):
    """A red run that alone outlasts the step's limit still gets its fix
    turn and a second run: the time went to the tests, not to the AI."""
    with_status(workspace, ["create", "analyze"])
    _test_cmd(workspace, "sleep 8; test -f green.txt")
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  printf 'green\\n' > green.txt && git add -A && git commit -q -m 'the test fix'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        "fi\n"
        f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", timeout_sec=6)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2


def test_cancel_commits_what_the_step_wrote_before_the_worktree_goes(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    ready = tmp_path / "ready"
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'half done\\n' > cancelled-work.txt\n"
        f"touch {ready}\n"
        "sleep 60\n"
    )
    env = {**os.environ, "AIDE_CLAUDE_BIN": str(claude)}
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
                "--project-name", "aide",
            "--command", "implement",
            "--spec", workspace["folder"],
            "--timeout-sec", "120",
            "--permission-mode", "acceptEdits",
            "--result-file", str(tmp_path / "result.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        wait_until(ready.exists, 60, "the step never started writing")
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert git(workspace["project"], "show", f"{BRANCH}:cancelled-work.txt") == "half done"


def test_a_cancelled_steps_commit_waits_for_the_checkout_lock_and_lets_go_of_it_AC_3(
        runner, workspace, fake_claude, tmp_path):
    """A cancelled step's commit and the worktree's removal hold the
    checkout's lock, which the next run takes before it cuts its worktree,
    so the commit never catches a fresh worktree's files. The lock is gone
    once the step has ended."""
    with_status(workspace, ["create", "analyze"])
    ready = tmp_path / "ready"
    claude = fake_claude(
        "cat > /dev/null\n"
        "printf 'half done\\n' > cancelled-work.txt\n"
        f"touch {ready}\n"
        "sleep 60\n"
    )
    env = {**os.environ, "AIDE_CLAUDE_BIN": str(claude)}
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
                "--project-name", "aide",
            "--command", "implement",
            "--spec", workspace["folder"],
            "--timeout-sec", "120",
            "--permission-mode", "acceptEdits",
            "--result-file", str(tmp_path / "result.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    lock = workspace["project"] / ".git" / "aide-run-spec-worktree.lock"
    try:
        wait_until(ready.exists, 60, "the step never started writing")
        # Another run holds the checkout: this process, alive.
        lock.mkdir()
        (lock / "pid").write_text(str(os.getpid()))
        proc.send_signal(signal.SIGTERM)
        time.sleep(3)
        assert proc.poll() is None, "the cancelled step did not wait for the lock"
        assert "cancelled-work.txt" not in git(workspace["project"], "ls-tree", "-r", "--name-only", BRANCH)
        (lock / "pid").unlink()
        lock.rmdir()
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert git(workspace["project"], "show", f"{BRANCH}:cancelled-work.txt") == "half done"
    assert not lock.exists(), "the cancelled step left the checkout's lock behind"


def test_a_cancel_while_the_merge_is_still_open_commits_no_conflict_markers(runner, workspace, fake_claude, tmp_path):
    """An implement is handed main's conflict open; a Cancel before the
    session resolved it leaves the branch where it was, never a merge
    commit with the markers in it."""
    with_status(workspace, ["create", "analyze"])
    branch = conflicting_branch(workspace)
    before = git(workspace["project"], "rev-parse", branch)
    ready = tmp_path / "ready"
    claude = fake_claude("cat > /dev/null\n" f"touch {ready}\n" "sleep 60\n")
    env = {**os.environ, "AIDE_CLAUDE_BIN": str(claude)}
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
                "--project-name", "aide",
            "--command", "implement",
            "--spec", workspace["folder"],
            "--timeout-sec", "120",
            "--permission-mode", "acceptEdits",
            "--result-file", str(tmp_path / "result.json"),
            "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        wait_until(ready.exists, 60, "the session never started")
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert "<<<<<<<" not in git(workspace["project"], "show", f"{branch}:contested.txt")
    assert git(workspace["project"], "rev-parse", branch) == before
