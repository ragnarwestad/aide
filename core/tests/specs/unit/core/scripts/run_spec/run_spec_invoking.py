"""Ways of invoking the runner beyond the plain one: a traced run, a
create, a schedule — and the small answers a test asks about a run
afterwards.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
"""

import contextlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import time
from ..conftest import git, run
# The files under lib/ the runner reads relative to its own location,
# each one without which a copy refuses before it starts:
# workflow/steps.sh, spec-reference.sh and spec-identity.json name the
# steps and the spec; workflow-steps.json, effort-levels.json,
# worktree-link-denylist.json (the denied link names) and
# runnable-tools.json (the tools --tool and the side tools may name) are
# read at start; status-progress.sh is sourced whenever a 4-status.md
# exists, which given the fixture is every run; files-to-change.sh reads
# the analysis's `### Files to change` for the short-analysis check;
# translation-files.sh is how the branch update merges; git-error.sh sorts
# a failed push and a conflict; tracking-info.sh is sourced before any
# phase; and the spec's state file and its phase moves are required like
# every part.
_RUNNER_LIB_FILES = (
    "workflow/steps.sh", "spec-reference.sh", "spec-identity.json", "workflow-steps.json",
    "effort-levels.json", "worktree-link-denylist.json", "runnable-tools.json",
    "status-progress.sh", "files-to-change.sh", "translation-files.sh", "git-error.sh",
    "tracking-info.sh", "spec-state.sh", "spec-transitions.sh", "failing-tests.sh",
    "checkout-lock.sh",
)


def _standalone_runner_copy(runner, tmp_path, name="aide-run-spec-under-test"):
    """A working stand-in for `aide-run-spec`, in its own directory: the
    script itself, plus the files it reads relative to its own location
    (`_aide-spec-lib.sh`, `lib/workflow-steps.json`,
    `lib/effort-levels.json`, `lib/worktree-link-denylist.json` and
    `lib/runnable-tools.json` too, without which every command refuses)."""
    source = pathlib.Path(runner).parent
    copy = tmp_path / name
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    (tmp_path / "_aide-spec-lib.sh").write_bytes((source / "_aide-spec-lib.sh").read_bytes())
    (tmp_path / "lib" / "workflow").mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "lib" / "step-endings", tmp_path / "lib" / "step-endings")
    for part in _RUNNER_LIB_FILES:
        (tmp_path / "lib" / part).write_bytes((source / "lib" / part).read_bytes())
    # And the runner's own phases (`lib/run-spec/`): the script sources
    # them by path, so a copy without them refuses before it starts.
    # Copied as a tree rather than one by one, so a phase that moves
    # between files does not have to be named here as well.
    shutil.copytree(source / "lib" / "run-spec", tmp_path / "lib" / "run-spec")
    return copy


BRANCH = "aide/81-queue-and-runner"


def worktrees(repo):
    """The worktree paths git knows about in `repo`, main one included."""
    out = git(repo, "worktree", "list", "--porcelain")
    return [l[len("worktree "):] for l in out.splitlines() if l.startswith("worktree ")]


def wait_until(condition, timeout, message):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError(message)


def run_traced(runner, workspace, claude, tmp_path, **kwargs):
    """Run with GIT_TRACE on, so a test can prove which git commands the
    script did NOT run."""
    trace = tmp_path / "git-trace.log"
    old = os.environ.get("GIT_TRACE")
    os.environ["GIT_TRACE"] = str(trace)
    try:
        rc, out, stdout = run(runner, workspace, claude, **kwargs)
    finally:
        if old is None:
            os.environ.pop("GIT_TRACE", None)
        else:
            os.environ["GIT_TRACE"] = old
    return rc, out, trace.read_text() if trace.exists() else ""


CREATE_KEY = "new-abc123de"


def create(runner, ws, claude, **kwargs):
    kwargs.setdefault("command", "create")
    kwargs.setdefault("spec", CREATE_KEY)
    kwargs.setdefault("title", "A new spec")
    kwargs.setdefault("description", "Do the thing that was asked for")
    return run(runner, ws, claude, **kwargs)


SCHEDULE_KEY = "schedule-nightly-report"


def schedule(runner, ws, claude, **kwargs):
    kwargs.setdefault("command", "schedule")
    kwargs.setdefault("spec", SCHEDULE_KEY)
    kwargs.setdefault("prompt_file", "docs/nightly-report.md")
    return run(runner, ws, claude, **kwargs)




@contextlib.contextmanager
def started_runner(runner, workspace, claude, tmp_path, command):
    """The runner started on the workspace's spec without waiting for it,
    the way the board starts a step it may cancel; killed on the way out
    if it is still running."""
    proc = subprocess.Popen(
        [
            str(runner),
            "--project-dir", str(workspace["project"]),
            "--project-name", "aide",
            "--command", command,
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
        yield proc
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)


def cancel_once(proc, ready, message):
    """Cancels a started runner the way the board does — SIGTERM — once
    `ready` exists, and waits for it to end."""
    wait_until(ready.exists, 60, message)
    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=60)
