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

