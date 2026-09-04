"""Ways of invoking the runner beyond the plain one: a traced run, a
create, a schedule — and the small answers a test asks about a run
afterwards.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
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
def _standalone_runner_copy(runner, tmp_path, name="aide-run-spec-under-test"):
    """A working stand-in for `aide-run-spec`, in its own directory: the
    script itself, plus the files it reads relative to its own location
    (`_aide-spec-lib.sh`, and — since spec 349 — `lib/workflow-steps.json`,
    and since spec 364 `lib/effort-levels.json` too, without which every
    command refuses)."""
    copy = tmp_path / name
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    (tmp_path / "lib").mkdir(exist_ok=True)
    (tmp_path / "lib" / "workflow-steps.json").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "workflow-steps.json").read_bytes()
    )
    # effort-levels.json too (spec 364): read the same way, without which
    # every command refuses just as it would with workflow-steps.json missing.
    (tmp_path / "lib" / "effort-levels.json").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "effort-levels.json").read_bytes()
    )
    # status-progress.sh too: sourced by the runner whenever a
    # 4-status.md exists — which, since spec 344's fixture, is every run.
    (tmp_path / "lib" / "status-progress.sh").write_bytes(
        (pathlib.Path(runner).parent / "lib" / "status-progress.sh").read_bytes()
    )
    # And the runner's own phases (`lib/run-spec-*.sh`, 2026-09-04): the
    # script sources them by name, so a copy without them refuses before
    # it starts. Copied by pattern rather than one by one, so a phase
    # that moves between files does not have to be named here as well.
    for part in sorted((pathlib.Path(runner).parent / "lib").glob("run-spec-*.sh")):
        (tmp_path / "lib" / part.name).write_bytes(part.read_bytes())
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


BRANCH = "aide/81-queue-and-runner"
