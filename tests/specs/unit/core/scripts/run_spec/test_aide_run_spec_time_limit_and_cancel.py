"""A step's time limit is the whole step's, the runner's own test run
included, and Cancel keeps what the step wrote. 498's implement ran for
over ninety minutes on a ninety-minute limit, its session done and the
runner's own suite still going; stopping it would have deleted fifty
files of finished work with the worktree (2026-09-19).
"""

import json
import os
import signal
import subprocess
import time
from ..conftest import git, run
from .run_spec_invoking import wait_until
from .run_spec_results import RESULT_OK
from .run_spec_status_files import with_status

BRANCH = "aide/81-queue-and-runner"


def _test_cmd(workspace, cmd):
    config = workspace["project"] / ".aide" / "config"
    config.write_text(config.read_text().replace("AIDE_TEST_CMD=true", f"AIDE_TEST_CMD={cmd}"))


def test_the_runners_own_test_run_stops_at_the_steps_time_limit(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    _test_cmd(workspace, "sleep 120")
    claude = fake_claude("cat > /dev/null\nprintf 'real work\\n' > implemented.txt\n" f"echo '{json.dumps(RESULT_OK)}'")
    began = time.monotonic()
    rc, out, _ = run(runner, workspace, claude, command="implement", timeout_sec=6)
    assert time.monotonic() - began < 60, "the suite ran on past the step's own limit"
    assert out["terminalReason"] == "timeout", out
    assert "while the project's tests were running" in out["error"]
    # The work is on the branch, for the next press to test.
    assert git(workspace["project"], "show", f"{BRANCH}:implemented.txt") == "real work"



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


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def test_what_the_session_left_running_is_stopped_when_its_turn_ends(runner, workspace, fake_claude, tmp_path):
    """A session's own suite started boards and decoy servers that outlived
    it, holding ports and slowing every later run (2026-09-19)."""
    with_status(workspace, ["create", "analyze"])
    pid_file = tmp_path / "leftover.pid"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"sleep 300 >/dev/null 2>&1 & echo $! > {pid_file}\n"
        "printf 'real work\\n' > implemented.txt\n"
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    run(runner, workspace, claude, command="implement")
    time.sleep(0.3)
    assert not _alive(int(pid_file.read_text()))
